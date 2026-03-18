import { DEFAULT_CONFIG } from "./constants.js";
import {
  DEFAULT_CLI_COMMANDS,
  SUPPORTED_PROVIDERS,
  normalizeProvider
} from "./providers.js";
import { normalizeTask } from "./tasks.js";
import { nowIso } from "./utils.js";

const OUTPUT_MODES = new Set(["pretty", "json"]);

export function normalizeConfig(raw = {}, options = {}) {
  const {
    preserveConfigUpdatedAt = false,
    preserveTaskState = false,
    preserveTaskUpdatedAt = false
  } = options;

  const timestamp = nowIso();
  const settings = normalizeSettings(raw.settings || {});
  const tasks = (raw.tasks || []).map((task) =>
    normalizeTask(task, settings, {
      preserveRuntime: preserveTaskState,
      preserveUpdatedAt: preserveTaskUpdatedAt
    })
  );

  assertUniqueTaskIds(tasks);

  return {
    version: Number(raw.version || DEFAULT_CONFIG.version),
    createdAt: raw.createdAt || timestamp,
    updatedAt:
      preserveConfigUpdatedAt && raw.updatedAt ? raw.updatedAt : timestamp,
    settings,
    tasks
  };
}

export function summarizeConfig(config) {
  const providers = new Set(
    config.tasks.map((task) => task.command.provider || config.settings.defaultProvider)
  );
  return {
    totalTasks: config.tasks.length,
    enabledTasks: config.tasks.filter((task) => task.enabled).length,
    providers: [...providers]
  };
}

function normalizeSettings(raw) {
  const defaults = DEFAULT_CONFIG.settings;
  const cliCommands = {
    ...DEFAULT_CLI_COMMANDS,
    ...(raw.cliCommands || {})
  };

  if (raw.opencodeCommand) {
    cliCommands.opencode = String(raw.opencodeCommand);
  }
  if (raw.codexCommand) {
    cliCommands.codex = String(raw.codexCommand);
  }
  if (raw.claudeCommand) {
    cliCommands.claude = String(raw.claudeCommand);
  }

  const settings = {
    timezone: String(raw.timezone || defaults.timezone),
    defaultProvider: normalizeProvider(
      raw.defaultProvider || defaults.defaultProvider
    ),
    cliCommands,
    attachUrl: String(raw.attachUrl || defaults.attachUrl),
    autoAttach:
      raw.autoAttach === undefined ? defaults.autoAttach : Boolean(raw.autoAttach),
    autoStartDaemon:
      raw.autoStartDaemon === undefined
        ? defaults.autoStartDaemon
        : Boolean(raw.autoStartDaemon),
    outputMode: raw.outputMode || defaults.outputMode,
    maxConcurrentRuns:
      raw.maxConcurrentRuns === undefined
        ? defaults.maxConcurrentRuns
        : Number(raw.maxConcurrentRuns)
  };

  if (!OUTPUT_MODES.has(settings.outputMode)) {
    throw new Error(`Unsupported output mode: ${settings.outputMode}`);
  }

  if (
    !Number.isInteger(settings.maxConcurrentRuns) ||
    settings.maxConcurrentRuns <= 0
  ) {
    throw new Error(
      `maxConcurrentRuns must be a positive integer, got ${raw.maxConcurrentRuns}`
    );
  }

  for (const provider of SUPPORTED_PROVIDERS) {
    if (!String(settings.cliCommands[provider] || "").trim()) {
      throw new Error(`CLI command for ${provider} must not be empty`);
    }
  }

  return settings;
}

function assertUniqueTaskIds(tasks) {
  const seen = new Set();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`);
    }
    seen.add(task.id);
  }
}
