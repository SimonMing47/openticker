import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CONFIG_PATH } from "./constants.js";
import { normalizeConfig, summarizeConfig } from "./config.js";
import { fileExists, readJson } from "./fs.js";
import { getDaemonStatus } from "./daemon.js";
import { getServiceStatus } from "./service.js";

const execFileAsync = promisify(execFile);

export async function runDoctor(options = {}) {
  const checks = [];

  checks.push(await checkCommand("node", [process.execPath, "--version"]));
  checks.push(await checkCommand("opencode", ["opencode", "--help"]));
  checks.push(await checkConfig());

  const daemon = await getDaemonStatus();
  checks.push({
    name: "daemon",
    ok: daemon.running,
    details: daemon.running ? `running pid=${daemon.pid}` : "stopped"
  });

  const service = await getServiceStatus();
  checks.push({
    name: "service",
    ok: service.installed,
    details: service.installed
      ? `${service.active ? "active" : "installed"} ${service.filePath}`
      : `not installed (${process.platform})`
  });

  if (options.strict) {
    const failed = checks.filter((check) => !check.ok && !["daemon", "service", "config"].includes(check.name));
    if (failed.length > 0) {
      const names = failed.map((check) => check.name).join(", ");
      throw new Error(`Doctor checks failed: ${names}`);
    }
  }

  return checks;
}

async function checkCommand(name, command) {
  try {
    const result = await execFileAsync(command[0], command.slice(1));
    const stdout = `${result.stdout || ""}${result.stderr || ""}`.trim();
    return {
      name,
      ok: true,
      details: stdout.split("\n")[0] || "available"
    };
  } catch (error) {
    return {
      name,
      ok: false,
      details: error.code === "ENOENT" ? "not found" : error.message
    };
  }
}

async function checkConfig() {
  const exists = await fileExists(CONFIG_PATH);
  if (!exists) {
    return {
      name: "config",
      ok: false,
      details: `missing ${CONFIG_PATH}`
    };
  }

  try {
    const raw = await readJson(CONFIG_PATH);
    const config = normalizeConfig(raw, {
      preserveConfigUpdatedAt: true,
      preserveTaskState: true,
      preserveTaskUpdatedAt: true
    });
    const summary = summarizeConfig(config);
    return {
      name: "config",
      ok: true,
      details: `${CONFIG_PATH} (${summary.totalTasks} tasks, ${summary.enabledTasks} enabled)`
    };
  } catch (error) {
    return {
      name: "config",
      ok: false,
      details: error instanceof Error ? error.message : String(error)
    };
  }
}
