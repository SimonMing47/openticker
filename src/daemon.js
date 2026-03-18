import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import {
  DEFAULT_POLL_INTERVAL_MS,
  PID_PATH,
  STATE_PATH
} from "./constants.js";
import { ensureAppDirs, fileExists, writeJson, readJson } from "./fs.js";
import { loadConfig, updateTask } from "./store.js";
import { markTaskResult, shouldRunTask } from "./tasks.js";
import { nowIso } from "./utils.js";
import { runTask } from "./runner.js";

const cliPath = fileURLToPath(new URL("../bin/openticker.js", import.meta.url));

export async function runDaemonLoop() {
  await ensureAppDirs();
  await fs.writeFile(PID_PATH, String(process.pid), "utf8");

  const activeRuns = new Set();
  let stopping = false;

  const shutdown = async () => {
    stopping = true;
    await writeState({
      pid: process.pid,
      status: "stopping",
      activeRuns: [...activeRuns],
      heartbeatAt: nowIso()
    });
    await fs.rm(PID_PATH, { force: true });
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  const tick = async () => {
    if (stopping) {
      return;
    }

    const config = await loadConfig();
    const maxConcurrent = Number(config.settings.maxConcurrentRuns || 1);
    await writeState({
      pid: process.pid,
      status: "running",
      activeRuns: [...activeRuns],
      heartbeatAt: nowIso()
    });

    for (const task of config.tasks) {
      if (activeRuns.size >= maxConcurrent) {
        break;
      }
      if (activeRuns.has(task.id) || !shouldRunTask(task)) {
        continue;
      }

      activeRuns.add(task.id);
      void runTask(task, config.settings)
        .then(async (result) => {
          await updateTask(task.id, (currentTask) =>
            markTaskResult(currentTask, result)
          );
        })
        .catch(async (error) => {
          await updateTask(task.id, (currentTask) =>
            markTaskResult(currentTask, {
              startedAt: nowIso(),
              finishedAt: nowIso(),
              durationMs: 0,
              exitCode: 1,
              error: error.message,
              logFile: null,
              outputPreview: null
            })
          );
        })
        .finally(async () => {
          activeRuns.delete(task.id);
          await writeState({
            pid: process.pid,
            status: "running",
            activeRuns: [...activeRuns],
            heartbeatAt: nowIso()
          });
        });
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, DEFAULT_POLL_INTERVAL_MS);
}

export async function startDetachedDaemon() {
  await ensureAppDirs();
  const alreadyRunning = await getDaemonStatus();
  if (alreadyRunning.running) {
    return alreadyRunning;
  }

  const child = spawn(process.execPath, [cliPath, "daemon", "run"], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  return {
    running: true,
    pid: child.pid
  };
}

export async function stopDetachedDaemon() {
  const status = await getDaemonStatus();
  if (!status.running || !status.pid) {
    return false;
  }
  process.kill(status.pid, "SIGTERM");
  return true;
}

export async function getDaemonStatus() {
  const pidRaw = await readPid();
  if (!pidRaw) {
    return { running: false, pid: null, state: null };
  }

  const pid = Number(pidRaw);
  const alive = isProcessRunning(pid);
  const state = await readJson(STATE_PATH, null);
  if (!alive) {
    await fs.rm(PID_PATH, { force: true });
    return { running: false, pid: null, state };
  }

  return { running: true, pid, state };
}

async function writeState(state) {
  await writeJson(STATE_PATH, state);
}

async function readPid() {
  if (!(await fileExists(PID_PATH))) {
    return null;
  }
  return (await fs.readFile(PID_PATH, "utf8")).trim();
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
