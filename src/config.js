import { DEFAULT_CONFIG } from "./constants.js";
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
  return {
    totalTasks: config.tasks.length,
    enabledTasks: config.tasks.filter((task) => task.enabled).length
  };
}

function normalizeSettings(raw) {
  const defaults = DEFAULT_CONFIG.settings;
  const settings = {
    timezone: String(raw.timezone || defaults.timezone),
    opencodeCommand: String(raw.opencodeCommand || defaults.opencodeCommand),
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

  if (!settings.opencodeCommand.trim()) {
    throw new Error("opencodeCommand must not be empty");
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
