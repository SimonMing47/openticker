import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  DEFAULT_TASK_TIMEOUT_MS,
  LOG_DIR
} from "./constants.js";
import { ensureAppDirs } from "./fs.js";
import { nowIso } from "./utils.js";

export async function runTask(task, settings, options = {}) {
  await ensureAppDirs();
  const startedAt = nowIso();
  const timestamp = startedAt.replaceAll(":", "-");
  const taskDir = path.join(LOG_DIR, task.id);
  const logFile = path.join(taskDir, `${timestamp}.log`);
  await fs.mkdir(taskDir, { recursive: true });

  const args = buildRunArgs(task, settings);
  const command = settings.opencodeCommand || "opencode";
  const timeoutMs = options.timeoutMs || DEFAULT_TASK_TIMEOUT_MS;
  const outputChunks = [];

  await fs.writeFile(
    logFile,
    [
      `# OpenTicker job log`,
      `task=${task.name}`,
      `id=${task.id}`,
      `startedAt=${startedAt}`,
      `cwd=${task.command.workdir}`,
      `command=${command} ${args.join(" ")}`
    ].join("\n") + "\n\n",
    "utf8"
  );

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: task.command.workdir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let finished = false;
    const finish = async (payload) => {
      if (finished) {
        return;
      }
      finished = true;
      const finishedAt = nowIso();
      const durationMs =
        new Date(finishedAt).getTime() - new Date(startedAt).getTime();
      const result = {
        startedAt,
        finishedAt,
        durationMs,
        logFile,
        outputPreview: outputChunks.join("").trim().slice(-2000),
        ...payload
      };

      const trailer = [
        "",
        "----",
        `finishedAt=${finishedAt}`,
        `durationMs=${durationMs}`,
        `exitCode=${result.exitCode ?? "null"}`,
        `error=${result.error || ""}`
      ].join("\n");
      await fs.appendFile(logFile, `${trailer}\n`, "utf8");
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      void finish({
        exitCode: 124,
        error: `Process timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);

    const onChunk = async (chunk, stream) => {
      const text = chunk.toString();
      outputChunks.push(text);
      if (outputChunks.join("").length > 10_000) {
        outputChunks.splice(0, outputChunks.length - 5);
      }
      await fs.appendFile(logFile, `[${stream}] ${text}`, "utf8");
    };

    child.stdout.on("data", (chunk) => {
      void onChunk(chunk, "stdout");
    });
    child.stderr.on("data", (chunk) => {
      void onChunk(chunk, "stderr");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      void finish({
        exitCode: 127,
        error: error.message
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      void finish({
        exitCode
      });
    });
  });
}

export function buildRunArgs(task, settings) {
  const args = ["run"];
  const command = task.command || {};

  if (command.commandName) {
    args.push("--command", command.commandName);
  }
  if (command.continueLast) {
    args.push("--continue");
  }
  if (command.session) {
    args.push("--session", command.session);
  }
  if (command.model) {
    args.push("--model", command.model);
  }
  if (command.agent) {
    args.push("--agent", command.agent);
  }
  if (command.title || task.name) {
    args.push("--title", command.title || task.name);
  }
  if (command.format === "json" || settings.outputMode === "json") {
    args.push("--format", "json");
  }

  const shouldAttach =
    command.attachStrategy === "always" ||
    (command.attachStrategy !== "never" && settings.autoAttach);
  if (shouldAttach && settings.attachUrl) {
    args.push("--attach", settings.attachUrl);
  }

  if (Array.isArray(command.extraArgs) && command.extraArgs.length > 0) {
    args.push(...command.extraArgs);
  }

  if (command.prompt) {
    args.push(command.prompt);
  }

  return args;
}
