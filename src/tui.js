import fs from "node:fs/promises";
import blessed from "blessed";
import dayjs from "dayjs";
import { addTask, listLogs, loadConfig, removeTask, updateTask } from "./store.js";
import { getDaemonStatus, startDetachedDaemon, stopDetachedDaemon } from "./daemon.js";
import {
  getServiceStatus,
  installService,
  startService,
  stopService
} from "./service.js";
import { markTaskResult, normalizeTask, toggleTask } from "./tasks.js";
import { runTask } from "./runner.js";
import { formatDateTime, formatDuration, resolveWorkdir } from "./utils.js";
import { formatDelay, humanizeSchedule, relativeToNow } from "./time.js";

const theme = {
  bg: "#081018",
  panel: "#0f1821",
  border: "#3de0b6",
  text: "#d7fff0",
  dim: "#6bbba0",
  accent: "#35d6ff",
  warning: "#ffb454",
  danger: "#ff6b6b",
  success: "#8ce99a"
};

const tagColors = {
  accent: "cyan",
  dim: "gray",
  warning: "yellow",
  danger: "red",
  success: "green",
  text: "white"
};

const presets = [
  {
    label: "Blank",
    value: {
      name: "New Task",
      type: "cron",
      schedule: { cron: "0 * * * *" },
      command: { prompt: "", attachStrategy: "inherit" }
    }
  },
  {
    label: "Hourly Keepalive",
    value: {
      name: "Hourly Keepalive",
      description: "Inspect workspace state and keep OpenCode warmed up.",
      type: "cron",
      schedule: { cron: "0 * * * *" },
      command: {
        prompt: "Inspect the current workspace, summarize changes since the last run, and exit with a concise note.",
        attachStrategy: "always"
      }
    }
  },
  {
    label: "Daily Repo Sweep",
    value: {
      name: "Daily Repo Sweep",
      description: "Run a daily repository review and produce a short plan.",
      type: "cron",
      schedule: { cron: "30 9 * * *" },
      command: {
        prompt: "Review the workspace, identify risks, and write a concise action plan for today.",
        attachStrategy: "inherit"
      }
    }
  },
  {
    label: "One-shot Release Check",
    value: {
      name: "One-shot Release Check",
      description: "Single execution before a release window.",
      type: "once",
      schedule: {
        at: dayjs().add(1, "hour").format("YYYY-MM-DD HH:mm")
      },
      command: {
        prompt: "Run a final release checklist on the workspace and summarize blockers.",
        attachStrategy: "inherit"
      }
    }
  },
  {
    label: "Delayed Follow-up",
    value: {
      name: "Delayed Follow-up",
      description: "Run once after a short delay.",
      type: "delay",
      schedule: { delayText: "30m" },
      command: {
        prompt: "Follow up on the latest work in the workspace and summarize what changed.",
        attachStrategy: "inherit"
      }
    }
  }
];

export async function startTui() {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    dockBorders: true,
    title: "OpenTicker"
  });

  screen.program.hideCursor();
  screen.key(["q", "C-c"], () => {
    screen.destroy();
    process.exit(0);
  });

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 4,
    tags: true,
    style: {
      fg: theme.text,
      bg: theme.bg
    }
  });

  const taskList = blessed.list({
    parent: screen,
    top: 4,
    left: 0,
    width: "31%",
    height: "100%-7",
    keys: true,
    vi: true,
    mouse: true,
    border: "line",
    label: " Jobs ",
    tags: true,
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.border
      },
      selected: {
        fg: theme.bg,
        bg: theme.accent,
        bold: true
      },
      item: {
        hover: {
          bg: "#14303d"
        }
      }
    },
    scrollbar: {
      ch: " ",
      track: {
        bg: "#0f2530"
      },
      style: {
        bg: theme.accent
      }
    }
  });

  const detail = blessed.box({
    parent: screen,
    top: 4,
    left: "31%",
    width: "69%",
    height: "63%",
    border: "line",
    label: " Job Detail ",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.border
      }
    }
  });

  const logs = blessed.box({
    parent: screen,
    top: "67%",
    left: "31%",
    width: "69%",
    height: "100%-10",
    border: "line",
    label: " Recent Log ",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: "#07131a",
      fg: "#b7ffe9",
      border: {
        fg: theme.border
      }
    }
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    style: {
      bg: theme.bg,
      fg: theme.dim
    }
  });

  const notifier = blessed.box({
    parent: screen,
    bottom: 3,
    right: 0,
    width: "shrink",
    height: 3,
    hidden: true,
    border: "line",
    padding: {
      left: 1,
      right: 1
    },
    tags: true,
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  const state = {
    config: null,
    daemon: null,
    service: null,
    selectedIndex: 0,
    lastRefreshAt: null
  };

  taskList.on("select", (_, index) => {
    state.selectedIndex = index;
    void render();
  });
  taskList.on("keypress", (_, key) => {
    if (key.name === "down") {
      state.selectedIndex = Math.min(
        state.selectedIndex + 1,
        Math.max((state.config?.tasks.length || 1) - 1, 0)
      );
      void render();
    }
    if (key.name === "up") {
      state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
      void render();
    }
  });

  screen.key(["a"], async () => {
    await createTaskFlow(screen, state, null);
    await refresh();
  });
  screen.key(["e"], async () => {
    const task = getSelectedTask(state);
    if (!task) {
      notify("No task selected", "warning");
      return;
    }
    await createTaskFlow(screen, state, task);
    await refresh();
  });
  screen.key(["space"], async () => {
    const task = getSelectedTask(state);
    if (!task) {
      return;
    }
    await updateTask(task.id, (currentTask) => toggleTask(currentTask));
    notify(`${task.name} ${task.enabled ? "disabled" : "enabled"}`, "success");
    await refresh();
  });
  screen.key(["x"], async () => {
    const task = getSelectedTask(state);
    if (!task) {
      return;
    }
    const confirmed = await askConfirm(
      screen,
      `Delete ${task.name}?`,
      "This removes the task definition and leaves old logs intact."
    );
    if (!confirmed) {
      return;
    }
    await removeTask(task.id);
    state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
    notify(`Deleted ${task.name}`, "success");
    await refresh();
  });
  screen.key(["r"], async () => {
    const task = getSelectedTask(state);
    if (!task) {
      return;
    }
    notify(`Running ${task.name}...`, "warning");
    const result = await runTask(task, state.config.settings);
    await updateTask(task.id, (currentTask) => markTaskResult(currentTask, result));
    notify(
      `${task.name} finished with exit ${result.exitCode}`,
      result.exitCode === 0 ? "success" : "danger"
    );
    await refresh();
  });
  screen.key(["d"], async () => {
      const daemon = await getDaemonStatus();
    if (daemon.running) {
      await stopDetachedDaemon();
      notify("Daemon stopped", "warning");
    } else {
      await startDetachedDaemon();
      notify("Daemon started", "success");
    }
    await refresh();
  });
  screen.key(["i"], async () => {
    const service = await getServiceStatus();
    if (!service.installed) {
      await installService();
      await startService();
      notify("Service installed and started", "success");
    } else if (!service.active) {
      await startService();
      notify("Service started", "success");
    } else {
      await stopService();
      notify("Service stopped", "warning");
    }
    await refresh();
  });
  screen.key(["l"], async () => {
    const task = getSelectedTask(state);
    if (!task) {
      return;
    }
    const paths = await listLogs(task.id);
    if (paths.length === 0) {
      notify("No logs for this task yet", "warning");
      return;
    }
    await showText(screen, `Logs for ${task.name}`, paths.join("\n"));
    await render();
  });
  screen.key(["?"], async () => {
    await showText(
      screen,
      "OpenTicker Hotkeys",
      [
        "[a] add task",
        "[e] edit task",
        "[space] enable or disable task",
        "[r] run selected task now",
        "[x] delete task",
        "[d] start or stop detached daemon",
        "[i] install/start or stop auto-start service",
        "[l] list log files",
        "[q] quit"
      ].join("\n")
    );
    await render();
  });

  async function refresh() {
    state.config = await loadConfig();
    state.daemon = await getDaemonStatus();
    state.service = await getServiceStatus();
    state.lastRefreshAt = new Date();
    if (state.selectedIndex >= state.config.tasks.length) {
      state.selectedIndex = Math.max(state.config.tasks.length - 1, 0);
    }
    await render();
  }

  async function render() {
    const tasks = state.config?.tasks || [];
    taskList.setItems(
      tasks.map((task) => {
        const stateColor = task.enabled ? tagColors.success : tagColors.dim;
        const schedule = task.runtime.nextRunAt
          ? relativeToNow(task.runtime.nextRunAt)
          : "paused";
        return `{${stateColor}-fg}${task.enabled ? "●" : "○"}{/}${task.enabled ? " " : " "} ${task.name} {${tagColors.dim}-fg}• ${task.type} • ${schedule}{/}`;
      })
    );

    if (tasks.length > 0) {
      taskList.select(state.selectedIndex);
    }

    header.setContent(renderHeader(state));
    detail.setContent(await renderTaskDetail(getSelectedTask(state)));
    logs.setContent(await renderLogs(getSelectedTask(state)));
    footer.setContent(
      `{${tagColors.dim}-fg} [a]add [e]edit [space]toggle [r]run [x]delete [d]daemon [i]service [l]logs [?]help [q]quit {/}`
    );
    screen.render();
  }

  function notify(message, level = "success") {
    const color =
      level === "danger"
        ? theme.danger
        : level === "warning"
          ? theme.warning
          : theme.success;
    notifier.style.border.fg = color;
    notifier.setContent(message);
    notifier.style.fg = color;
    notifier.show();
    screen.render();
    setTimeout(() => {
      notifier.hide();
      screen.render();
    }, 2500);
  }

  await refresh();
  setInterval(() => {
    void refresh();
  }, 2000);
}

function renderHeader(state) {
  const total = state.config?.tasks.length || 0;
  const active = state.config?.tasks.filter((task) => task.enabled).length || 0;
  const daemonLine = state.daemon?.running
    ? `{${tagColors.success}-fg}daemon up pid=${state.daemon.pid}{/}`
    : `{${tagColors.warning}-fg}daemon down{/}`;
  const serviceLine = state.service?.installed
    ? state.service.active
      ? `{${tagColors.success}-fg}service active{/}`
      : `{${tagColors.warning}-fg}service installed{/}`
    : `{${tagColors.dim}-fg}service off{/}`;
  const updated = state.lastRefreshAt
    ? dayjs(state.lastRefreshAt).format("HH:mm:ss")
    : "--:--:--";

  return [
    `{${tagColors.accent}-fg}{bold}OPEN{/bold}{/} {${tagColors.success}-fg}{bold}TICKER{/bold}{/} {${tagColors.dim}-fg}// geek scheduler console{/}`,
    ` {${tagColors.dim}-fg}jobs{/} {${tagColors.text}-fg}${active}/${total}{/}  ${daemonLine}  ${serviceLine}  {${tagColors.dim}-fg}refresh ${updated}{/}`
  ].join("\n");
}

async function renderTaskDetail(task) {
  if (!task) {
    return `{${tagColors.dim}-fg}No tasks yet. Press [a] to create one.{/}`;
  }

  const lines = [
    `{bold}${task.name}{/bold}`,
    `${task.description || "No description"}`,
    "",
    `{${tagColors.dim}-fg}id{/} ${task.id}`,
    `{${tagColors.dim}-fg}state{/} ${task.enabled ? "enabled" : "disabled"}`,
    `{${tagColors.dim}-fg}type{/} ${task.type}`,
    `{${tagColors.dim}-fg}schedule{/} ${humanizeSchedule(task)}`,
    `{${tagColors.dim}-fg}next run{/} ${task.runtime.nextRunAt ? `${formatDateTime(task.runtime.nextRunAt)} (${relativeToNow(task.runtime.nextRunAt)})` : "n/a"}`,
    `{${tagColors.dim}-fg}workdir{/} ${task.command.workdir}`,
    `{${tagColors.dim}-fg}attach{/} ${task.command.attachStrategy}`,
    `{${tagColors.dim}-fg}model{/} ${task.command.model || "-"}`,
    `{${tagColors.dim}-fg}agent{/} ${task.command.agent || "-"}`,
    `{${tagColors.dim}-fg}command{/} ${task.command.commandName || "prompt"}`,
    `{${tagColors.dim}-fg}created{/} ${formatDateTime(task.createdAt)}`,
    `{${tagColors.dim}-fg}updated{/} ${formatDateTime(task.updatedAt)}`,
    "",
    `{${tagColors.dim}-fg}prompt{/}`,
    task.command.prompt || "-"
  ];

  if (task.runtime.lastRunAt) {
    lines.push(
      "",
      `{${tagColors.dim}-fg}last run{/} ${formatDateTime(task.runtime.lastRunAt)}`,
      `{${tagColors.dim}-fg}last exit{/} ${task.runtime.lastExitCode}`,
      `{${tagColors.dim}-fg}duration{/} ${formatDuration(task.runtime.lastDurationMs)}`,
      `{${tagColors.dim}-fg}runs{/} ${task.runtime.runCount}`,
      `{${tagColors.dim}-fg}last log{/} ${task.runtime.lastLogFile || "-"}`,
      `{${tagColors.dim}-fg}preview{/}`,
      task.runtime.lastOutputPreview || "-"
    );
  }

  return lines.join("\n");
}

async function renderLogs(task) {
  if (!task?.runtime?.lastLogFile) {
    return `{${tagColors.dim}-fg}No run log yet.{/}`;
  }

  try {
    const content = await fs.readFile(task.runtime.lastLogFile, "utf8");
    return content.split("\n").slice(-24).join("\n");
  } catch {
    return `{${tagColors.warning}-fg}Latest log file could not be read.{/}`;
  }
}

function getSelectedTask(state) {
  return state.config?.tasks?.[state.selectedIndex] || null;
}

async function createTaskFlow(screen, state, existingTask) {
  const defaults = state.config?.settings || {};
  const seed = existingTask
    ? structuredClone(existingTask)
    : structuredClone((await choosePreset(screen)).value);

  const name = await askInput(screen, "Task name", seed.name || "");
  if (!name) {
    return;
  }

  const description = await askInput(screen, "Description", seed.description || "");
  const type = existingTask
    ? existingTask.type
    : await chooseValue(screen, "Task type", [
        ["cron", "Recurring cron"],
        ["once", "One-shot datetime"],
        ["delay", "Run after delay"]
      ], seed.type || "cron");

  const schedule = {};
  if (type === "cron") {
    schedule.cron = await askInput(
      screen,
      "Cron expression",
      seed.schedule?.cron || "0 * * * *"
    );
    schedule.timezone = await askInput(
      screen,
      "Timezone",
      seed.schedule?.timezone || defaults.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  } else if (type === "once") {
    const defaultAt = seed.schedule?.at
      ? dayjs(seed.schedule.at).format("YYYY-MM-DD HH:mm")
      : dayjs().add(1, "hour").format("YYYY-MM-DD HH:mm");
    schedule.at = await askInput(screen, "Datetime", defaultAt);
  } else {
    schedule.delayText = await askInput(
      screen,
      "Delay",
      seed.schedule?.delayText || formatDelay(seed.schedule?.delayMs || 30 * 60 * 1000)
    );
  }

  const mode = await chooseValue(
    screen,
    "OpenCode mode",
    [
      ["prompt", "Run a prompt"],
      ["command", "Run a named opencode command"]
    ],
    seed.command?.commandName ? "command" : "prompt"
  );
  const commandName =
    mode === "command"
      ? await askInput(screen, "OpenCode command name", seed.command?.commandName || "")
      : "";
  const prompt = await askInput(
    screen,
    mode === "command" ? "Arguments or prompt body" : "Prompt",
    seed.command?.prompt || ""
  );
  const workdir = resolveWorkdir(
    await askInput(screen, "Workdir", seed.command?.workdir || process.cwd())
  );
  const model = await askInput(screen, "Model (optional)", seed.command?.model || "");
  const agent = await askInput(screen, "Agent (optional)", seed.command?.agent || "");
  const title = await askInput(screen, "Run title (optional)", seed.command?.title || "");
  const attachStrategy = await chooseValue(
    screen,
    "Attach strategy",
    [
      ["inherit", "Follow global attach setting"],
      ["always", "Always use --attach"],
      ["never", "Never attach"]
    ],
    seed.command?.attachStrategy || "inherit"
  );
  const extraArgs = await askInput(
    screen,
    "Extra args",
    Array.isArray(seed.command?.extraArgs) ? seed.command.extraArgs.join(" ") : ""
  );
  const enabled = await askConfirm(
    screen,
    "Enable this task now?",
    "Disabled tasks stay visible in the list but never run."
  );

  const input = {
    ...(existingTask ? { id: existingTask.id, createdAt: existingTask.createdAt, runtime: existingTask.runtime } : {}),
    name,
    description,
    type,
    enabled,
    overlapPolicy: "skip",
    schedule,
    command: {
      mode,
      prompt,
      workdir,
      attachStrategy,
      extraArgs,
      model,
      agent,
      title,
      format: state.config?.settings?.outputMode || "pretty",
      commandName
    }
  };

  const normalized = normalizeTask(input, defaults);
  if (existingTask) {
    await updateTask(existingTask.id, () => normalized);
  } else {
    await addTask(normalized);
  }
}

async function choosePreset(screen) {
  const value = await chooseValue(
    screen,
    "Choose a preset",
    presets.map((preset) => [preset.label, preset.label]),
    presets[0].label
  );
  return presets.find((preset) => preset.label === value) || presets[0];
}

async function askInput(screen, label, initial = "") {
  const prompt = blessed.prompt({
    parent: screen,
    border: "line",
    label: ` ${label} `,
    width: "70%",
    height: 9,
    top: "center",
    left: "center",
    tags: true,
    keys: true,
    vi: true,
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  return new Promise((resolve) => {
    prompt.input(label, initial, (_, value) => {
      prompt.destroy();
      screen.render();
      resolve(value ?? "");
    });
    screen.render();
  });
}

async function askConfirm(screen, title, body) {
  const modal = blessed.box({
    parent: screen,
    width: "60%",
    height: 9,
    top: "center",
    left: "center",
    border: "line",
    label: ` ${title} `,
    tags: true,
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.warning
      }
    }
  });
  blessed.text({
    parent: modal,
    top: 1,
    left: 1,
    width: "100%-2",
    content: body
  });
  const yes = blessed.button({
    parent: modal,
    mouse: true,
    keys: true,
    shrink: true,
    top: 5,
    left: "center-10",
    name: "yes",
    content: "  Yes  ",
    border: "line",
    style: buttonStyle(theme.success)
  });
  const no = blessed.button({
    parent: modal,
    mouse: true,
    keys: true,
    shrink: true,
    top: 5,
    left: "center+3",
    name: "no",
    content: "  No  ",
    border: "line",
    style: buttonStyle(theme.danger)
  });

  return new Promise((resolve) => {
    const done = (value) => {
      modal.destroy();
      screen.render();
      resolve(value);
    };
    yes.on("press", () => done(true));
    no.on("press", () => done(false));
    modal.key(["left", "h"], () => yes.focus());
    modal.key(["right", "l"], () => no.focus());
    modal.key(["enter"], () => done(screen.focused === yes));
    modal.key(["escape", "q"], () => done(false));
    yes.focus();
    screen.render();
  });
}

async function chooseValue(screen, title, choices, initialValue) {
  const modal = blessed.box({
    parent: screen,
    width: "62%",
    height: 16,
    top: "center",
    left: "center",
    border: "line",
    label: ` ${title} `,
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  const list = blessed.list({
    parent: modal,
    top: 1,
    left: 1,
    width: "100%-2",
    height: "100%-2",
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    items: choices.map(([value, description]) => `${value}  {${tagColors.dim}-fg}${description}{/}`),
    style: {
      bg: theme.panel,
      fg: theme.text,
      selected: {
        bg: theme.accent,
        fg: theme.bg,
        bold: true
      }
    }
  });

  const initialIndex = Math.max(
    choices.findIndex(([value]) => value === initialValue),
    0
  );

  return new Promise((resolve) => {
    const done = (value) => {
      modal.destroy();
      screen.render();
      resolve(value);
    };
    list.focus();
    list.select(initialIndex);
    list.on("select", (_, index) => done(choices[index][0]));
    modal.key(["escape", "q"], () => done(initialValue || choices[0][0]));
    screen.render();
  });
}

async function showText(screen, title, content) {
  const modal = blessed.box({
    parent: screen,
    width: "72%",
    height: "72%",
    top: "center",
    left: "center",
    border: "line",
    label: ` ${title} `,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    content,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  return new Promise((resolve) => {
    modal.key(["escape", "q", "enter"], () => {
      modal.destroy();
      screen.render();
      resolve();
    });
    modal.focus();
    screen.render();
  });
}

function buttonStyle(color) {
  return {
    fg: theme.text,
    bg: theme.panel,
    border: {
      fg: color
    },
    focus: {
      fg: theme.bg,
      bg: color
    },
    hover: {
      fg: theme.bg,
      bg: color
    }
  };
}
