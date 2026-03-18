import { DEFAULT_TIMEZONE } from "./constants.js";
import { normalizeProvider } from "./providers.js";
import { createId, nowIso, resolveWorkdir, splitArgs } from "./utils.js";
import { fromDelay, parseCronNext, parseDateInput } from "./time.js";

const ATTACH_STRATEGIES = new Set(["inherit", "always", "never"]);
const OUTPUT_FORMATS = new Set(["pretty", "json"]);
const OVERLAP_POLICIES = new Set(["skip"]);

function defaultRuntime() {
  return {
    runCount: 0,
    lastRunAt: null,
    lastExitCode: null,
    lastDurationMs: null,
    nextRunAt: null,
    lastError: null,
    lastLogFile: null,
    lastOutputPreview: null
  };
}

export function normalizeTask(input, defaults = {}, options = {}) {
  const { preserveRuntime = false, preserveUpdatedAt = false } = options;
  const timestamp = nowIso();
  const createdAt = input.createdAt || timestamp;
  const updatedAt =
    preserveUpdatedAt && input.updatedAt ? input.updatedAt : timestamp;
  const type = input.type;
  const task = {
    id: input.id || createId(type || "task"),
    name: input.name?.trim(),
    description: input.description?.trim() || "",
    type,
    schedule: {},
    command: {
      provider: normalizeProvider(
        input.command?.provider,
        defaults.defaultProvider || "opencode"
      ),
      mode: input.command?.mode || "prompt",
      prompt: input.command?.prompt?.trim() || "",
      workdir: resolveWorkdir(input.command?.workdir || defaults.workdir),
      attachStrategy: input.command?.attachStrategy || "inherit",
      extraArgs: normalizeArgs(input.command?.extraArgs),
      model: input.command?.model?.trim() || "",
      agent: input.command?.agent?.trim() || "",
      title: input.command?.title?.trim() || "",
      format: input.command?.format || defaults.format || "pretty",
      commandName: input.command?.commandName?.trim() || "",
      continueLast: Boolean(input.command?.continueLast),
      session: input.command?.session?.trim() || ""
    },
    enabled: input.enabled ?? true,
    overlapPolicy: input.overlapPolicy || "skip",
    createdAt,
    updatedAt,
    runtime: {
      ...defaultRuntime(),
      ...(preserveRuntime ? input.runtime || {} : {})
    }
  };

  if (!task.name) {
    throw new Error("Task name is required");
  }
  if (!ATTACH_STRATEGIES.has(task.command.attachStrategy)) {
    throw new Error(
      `Unsupported attach strategy: ${task.command.attachStrategy}`
    );
  }
  if (!OUTPUT_FORMATS.has(task.command.format)) {
    throw new Error(`Unsupported task format: ${task.command.format}`);
  }
  if (!OVERLAP_POLICIES.has(task.overlapPolicy)) {
    throw new Error(`Unsupported overlap policy: ${task.overlapPolicy}`);
  }

  if (type === "cron") {
    if (!input.schedule?.cron) {
      throw new Error("Cron expression is required");
    }
    task.schedule = {
      cron: input.schedule.cron.trim(),
      timezone:
        input.schedule.timezone?.trim() || defaults.timezone || DEFAULT_TIMEZONE
    };
  } else if (type === "once") {
    const at = parseDateValue(input.schedule?.at);
    task.schedule = {
      at: at.toISOString()
    };
  } else if (type === "delay") {
    let runAt = input.schedule?.runAt;
    let delayMs = input.schedule?.delayMs;
    let delayText = input.schedule?.delayText;

    if (!runAt) {
      if (input.schedule?.delayText) {
        const delay = fromDelay(input.schedule.delayText);
        runAt = delay.runAt.toISOString();
        delayMs = delay.delayMs;
        delayText = input.schedule.delayText;
      } else {
        throw new Error("Delay task requires delayText or runAt");
      }
    }

    task.schedule = {
      runAt: new Date(runAt).toISOString(),
      delayMs: Number(delayMs || new Date(runAt).getTime() - new Date(createdAt).getTime()),
      delayText: delayText || ""
    };
  } else {
    throw new Error(`Unsupported task type: ${type}`);
  }

  if (!task.command.prompt && !task.command.commandName) {
    throw new Error("Prompt or command name is required");
  }

  task.runtime.nextRunAt = resolveNextRun(task, preserveRuntime);
  return task;
}

export function calculateNextRun(task, baseDate = new Date()) {
  if (!task.enabled) {
    return null;
  }

  if (task.type === "cron") {
    return parseCronNext(task.schedule.cron, task.schedule.timezone, baseDate);
  }

  if (task.type === "once") {
    return new Date(task.schedule.at);
  }

  if (task.type === "delay") {
    return new Date(task.schedule.runAt);
  }

  return null;
}

export function shouldRunTask(task, currentDate = new Date()) {
  if (!task.enabled) {
    return false;
  }
  const nextRun = task.runtime?.nextRunAt || calculateNextRun(task)?.toISOString();
  if (!nextRun) {
    return false;
  }
  return new Date(nextRun).getTime() <= currentDate.getTime();
}

export function markTaskResult(task, result, options = {}) {
  const { consumeSchedule = true } = options;
  const updated = structuredClone(task);
  updated.updatedAt = nowIso();
  updated.runtime = {
    ...defaultRuntime(),
    ...(updated.runtime || {}),
    runCount: Number(updated.runtime?.runCount || 0) + 1,
    lastRunAt: result.startedAt,
    lastExitCode: result.exitCode,
    lastDurationMs: result.durationMs,
    lastError: result.error || null,
    lastLogFile: result.logFile,
    lastOutputPreview: result.outputPreview || null
  };

  if (!consumeSchedule) {
    updated.runtime.nextRunAt = updated.enabled
      ? calculateNextRun(updated)?.toISOString() || updated.runtime.nextRunAt
      : null;
    return updated;
  }

  if (updated.type === "cron" && updated.enabled) {
    updated.runtime.nextRunAt = calculateNextRun(
      updated,
      new Date(new Date(result.finishedAt).getTime() + 1000)
    )?.toISOString();
  } else {
    updated.enabled = false;
    updated.runtime.nextRunAt = null;
  }

  return updated;
}

export function toggleTask(task, enabled = !task.enabled) {
  const updated = structuredClone(task);
  updated.enabled = enabled;
  updated.updatedAt = nowIso();
  updated.runtime = {
    ...defaultRuntime(),
    ...(updated.runtime || {}),
    nextRunAt: enabled ? calculateNextRun(updated)?.toISOString() || null : null
  };
  return updated;
}

export function buildTaskFromCli(options, defaults = {}) {
  const type = options.type;
  const input = {
    name: options.name,
    description: options.description,
    type,
    enabled: !options.disabled,
    schedule: {},
    command: {
      mode: options.commandName ? "command" : "prompt",
      provider: options.provider || defaults.defaultProvider || "opencode",
      prompt: options.prompt || "",
      workdir: options.workdir,
      attachStrategy: options.attach || "inherit",
      extraArgs: options.extraArgs || [],
      model: options.model || "",
      agent: options.agent || "",
      title: options.title || "",
      format: options.format || defaults.format || "pretty",
      commandName: options.commandName || "",
      continueLast: Boolean(options.continueLast),
      session: options.session || ""
    }
  };

  if (type === "cron") {
    input.schedule.cron = options.cron;
    input.schedule.timezone = options.timezone || defaults.timezone;
  } else if (type === "once") {
    input.schedule.at = options.at;
  } else if (type === "delay") {
    input.schedule.delayText = options.delay;
  }

  return normalizeTask(input, defaults);
}

export function taskToLine(task) {
  return `${task.enabled ? "●" : "○"} ${task.name} [${task.type}]`;
}

function parseDateValue(raw) {
  if (raw instanceof Date) {
    return raw;
  }
  return parseDateInput(String(raw));
}

function normalizeArgs(rawArgs) {
  if (Array.isArray(rawArgs)) {
    return rawArgs.flatMap((item) => splitArgs(item)).filter(Boolean);
  }
  if (typeof rawArgs === "string") {
    return splitArgs(rawArgs);
  }
  return [];
}

function resolveNextRun(task, preserveRuntime) {
  if (!task.enabled) {
    return null;
  }

  const computedNextRun = calculateNextRun(task)?.toISOString() || null;
  if (!preserveRuntime) {
    return computedNextRun;
  }

  const existingNextRun = task.runtime?.nextRunAt;
  if (!existingNextRun) {
    return computedNextRun;
  }

  const parsedExistingNextRun = new Date(existingNextRun);
  if (Number.isNaN(parsedExistingNextRun.getTime())) {
    return computedNextRun;
  }

  return parsedExistingNextRun.toISOString();
}
