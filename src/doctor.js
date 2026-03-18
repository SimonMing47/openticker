import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CONFIG_PATH } from "./constants.js";
import { normalizeConfig, summarizeConfig } from "./config.js";
import { fileExists, readJson } from "./fs.js";
import {
  providerCommand,
  providerExecutable,
  providerLabel
} from "./providers.js";
import { getDaemonStatus } from "./daemon.js";
import { getServiceStatus } from "./service.js";

const execFileAsync = promisify(execFile);

export async function runDoctor(options = {}) {
  const checks = [];
  const configCheck = await checkConfig();
  const config = configCheck.config;

  checks.push(await checkCommand("node", [process.execPath, "--version"]));
  checks.push(...(await checkProviderCommands(config)));
  checks.push(configCheck);

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
    const failed = checks.filter(
      (check) => !check.ok && check.required !== false && !["daemon", "service", "config"].includes(check.name)
    );
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
      details:
        `${CONFIG_PATH} (${summary.totalTasks} tasks, ${summary.enabledTasks} enabled, ` +
        `providers: ${summary.providers.join(", ") || "none"})`,
      config
    };
  } catch (error) {
    return {
      name: "config",
      ok: false,
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkProviderCommands(config) {
  const checks = [];
  const settings = config?.settings || {
    defaultProvider: "opencode",
    cliCommands: {
      opencode: "opencode",
      codex: "codex",
      claude: "claude"
    }
  };
  const requiredProviders = new Set([settings.defaultProvider || "opencode"]);

  for (const task of config?.tasks || []) {
    requiredProviders.add(task.command?.provider || settings.defaultProvider || "opencode");
  }

  for (const provider of ["opencode", "codex", "claude"]) {
    const command = providerCommand(settings, provider);
    const executable = providerExecutable(settings, provider);
    const check = await checkCommand(
      `cli:${provider}`,
      [executable.command, ...executable.args, "--help"]
    );
    check.required = requiredProviders.has(provider);
    check.details = `${providerLabel(provider)} -> ${command}; ${check.details}`;
    checks.push(check);
  }

  return checks;
}
