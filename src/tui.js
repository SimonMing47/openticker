import fs from "node:fs/promises";
import blessed from "blessed";
import dayjs from "dayjs";
import { addTask, loadConfig, removeTask, updateTask } from "./store.js";
import { getDaemonStatus, startDetachedDaemon, stopDetachedDaemon } from "./daemon.js";
import {
  getServiceStatus,
  installService,
  startService,
  stopService
} from "./service.js";
import { providerHelp, providerLabel } from "./providers.js";
import { markTaskResult, normalizeTask, toggleTask } from "./tasks.js";
import { runTask } from "./runner.js";
import {
  formatDateTime,
  formatDuration,
  resolveWorkdir
} from "./utils.js";
import { formatDelay, humanizeSchedule, relativeToNow } from "./time.js";

const theme = {
  bg: "#0b0f14",
  panel: "#121720",
  panelAlt: "#171d27",
  border: "#293241",
  accent: "#7dd3fc",
  success: "#8ce99a",
  warning: "#ffbd59",
  danger: "#ff7b72",
  text: "#f5f7fa",
  dim: "#94a3b8",
  muted: "#4b5563"
};

const tagColors = {
  accent: "cyan",
  border: "white",
  success: "green",
  warning: "yellow",
  danger: "red",
  text: "white",
  dim: "gray"
};

const taskTypes = ["cron", "once", "delay"];
const cliProviders = ["opencode", "codex", "claude"];
const attachStrategies = ["inherit", "always", "never"];
const presetIds = ["heartbeat", "daily", "once", "delay"];

export async function startTui() {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    dockBorders: true,
    title: "OpenTicker"
  });

  const state = {
    config: null,
    daemon: null,
    service: null,
    selectedIndex: 0,
    lastRefreshAt: null,
    modalOpen: false,
    notifyTimer: null
  };

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
      bg: theme.bg,
      fg: theme.text
    }
  });

  const actionBar = blessed.box({
    parent: screen,
    top: 4,
    left: 0,
    width: "100%",
    height: 6,
    style: {
      bg: theme.bg
    }
  });

  const content = blessed.box({
    parent: screen,
    top: 10,
    left: 0,
    width: "100%",
    height: "100%-13",
    style: {
      bg: theme.bg
    }
  });

  const taskList = blessed.list({
    parent: content,
    top: 0,
    left: 0,
    width: "33%",
    height: "100%",
    label: " 任务列表 ",
    border: "line",
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    padding: {
      left: 1,
      right: 1
    },
    scrollbar: {
      ch: " ",
      track: {
        bg: theme.muted
      },
      style: {
        bg: theme.accent
      }
    },
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.border
      },
      selected: {
        fg: theme.bg,
        bg: theme.border,
        bold: true
      },
      item: {
        hover: {
          bg: "#1a233d"
        }
      }
    }
  });

  const summary = blessed.box({
    parent: content,
    top: 0,
    left: "33%",
    width: "67%",
    height: "42%",
    label: " 概览 ",
    border: "line",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
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

  const promptPanel = blessed.box({
    parent: content,
    top: "42%",
    left: "33%",
    width: "67%",
    height: "20%",
    label: " 提示词 / 执行说明 ",
    border: "line",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: theme.panelAlt,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  const logPanel = blessed.box({
    parent: content,
    top: "62%",
    left: "33%",
    width: "67%",
    height: "38%",
    label: " 最近日志 ",
    border: "line",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
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
    right: 1,
    bottom: 3,
    width: "shrink",
    height: 3,
    hidden: true,
    padding: {
      left: 1,
      right: 1
    },
    border: "line",
    style: {
      bg: theme.panelAlt,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  const primaryDock = blessed.box({
    parent: actionBar,
    top: 0,
    left: 0,
    width: "69%",
    height: 6,
    label: " 指令坞 ",
    tags: true,
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.border
      }
    },
    border: "line"
  });

  const systemDock = blessed.box({
    parent: actionBar,
    top: 0,
    left: "70%",
    width: "30%",
    height: 6,
    label: " 控制中心 ",
    tags: true,
    style: {
      bg: theme.panelAlt,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    },
    border: "line"
  });

  const primaryHint = blessed.box({
    parent: primaryDock,
    top: 0,
    left: 2,
    width: "100%-4",
    height: 1,
    tags: true,
    content: `{${tagColors.dim}-fg}新建、快启、编辑、运行。{/}`
  });

  const systemHint = blessed.box({
    parent: systemDock,
    top: 0,
    left: 2,
    width: "100%-4",
    height: 1,
    tags: true,
    content: ""
  });

  const actionButtons = createActionButtons(primaryDock, {
    onCreate: () => void openEditor({ quick: false }),
    onQuickStart: () => void openEditor({ quick: true }),
    onEdit: () => void editSelectedTask(),
    onRun: () => void runSelectedTask()
  });

  const systemButtons = createSystemButtons(systemDock, {
    onSystem: () => void openControlCenter()
  });

  taskList.on("select", (_, index) => {
    state.selectedIndex = index;
    void render();
  });

  screen.key(["n"], () => {
    if (state.modalOpen) {
      return;
    }
    void openEditor({ quick: false });
  });
  screen.key(["s"], () => {
    if (state.modalOpen) {
      return;
    }
    void openEditor({ quick: true });
  });
  screen.key(["e"], () => {
    if (state.modalOpen) {
      return;
    }
    void editSelectedTask();
  });
  screen.key(["r"], () => {
    if (state.modalOpen) {
      return;
    }
    void runSelectedTask();
  });
  screen.key(["space"], () => {
    if (state.modalOpen) {
      return;
    }
    void toggleSelectedTask();
  });
  screen.key(["x"], () => {
    if (state.modalOpen) {
      return;
    }
    void deleteSelectedTask();
  });
  screen.key(["d"], () => {
    if (state.modalOpen) {
      return;
    }
    void toggleDaemon();
  });
  screen.key(["i"], () => {
    if (state.modalOpen) {
      return;
    }
    void toggleService();
  });
  screen.key(["?"], () => {
    if (state.modalOpen) {
      return;
    }
    void showHelp();
  });

  screen.on("resize", () => {
    void render();
  });

  await refresh(true);
  taskList.focus();

  setInterval(() => {
    void refresh(false);
  }, 2000);

  async function refresh(forceRender = false) {
    state.config = await loadConfig();
    state.daemon = await getDaemonStatus();
    state.service = await getServiceStatus();
    state.lastRefreshAt = new Date();

    if (state.selectedIndex >= state.config.tasks.length) {
      state.selectedIndex = Math.max(state.config.tasks.length - 1, 0);
    }

    if (forceRender || !state.modalOpen) {
      await render();
    }
  }

  async function render() {
    const tasks = state.config?.tasks || [];
    header.setContent(renderHeader(state));
    layoutButtonRow(primaryDock, actionButtons, {
      top: 2,
      left: 2,
      right: 2,
      gap: 1
    });
    layoutButtonRow(systemDock, systemButtons, {
      top: 2,
      left: 2,
      right: 2,
      gap: 1
    });

    taskList.setItems(tasks.map((task) => formatTaskListItem(task)));
    if (tasks.length > 0) {
      taskList.select(state.selectedIndex);
    }

    summary.setContent(renderTaskSummary(getSelectedTask(state)));
    promptPanel.setContent(renderPromptPanel(getSelectedTask(state)));
    logPanel.setContent(await renderLogPanel(getSelectedTask(state)));
    footer.setContent(renderFooter());
    updateActionButtonLabels(actionButtons, state);
    updateSystemButtonLabels(systemButtons, systemHint, state);
    screen.render();
  }

  function notify(message, level = "success") {
    const borderColor =
      level === "danger"
        ? theme.danger
        : level === "warning"
          ? theme.warning
          : theme.success;

    notifier.style.border.fg = borderColor;
    notifier.style.fg = borderColor;
    notifier.setContent(message);
    notifier.show();

    if (state.notifyTimer) {
      clearTimeout(state.notifyTimer);
    }

    state.notifyTimer = setTimeout(() => {
      notifier.hide();
      screen.render();
    }, 2600);

    screen.render();
  }

  async function openEditor(options = {}) {
    state.modalOpen = true;
    try {
      const result = await openTaskEditor(screen, state, options);
      if (!result) {
        return;
      }
      if (result.ranNow) {
        notify(
          `${result.task.name} 已保存，并完成一次立即执行`,
          result.exitCode === 0 ? "success" : "warning"
        );
      } else {
        notify(`${result.task.name} 已保存`, "success");
      }
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      state.modalOpen = false;
      await refresh(true);
    }
  }

  async function editSelectedTask() {
    const task = getSelectedTask(state);
    if (!task) {
      notify("当前没有可编辑的任务", "warning");
      return;
    }
    await openEditor({ existingTask: task, quick: false });
  }

  async function runSelectedTask() {
    const task = getSelectedTask(state);
    if (!task) {
      notify("当前没有可运行的任务", "warning");
      return;
    }

    try {
      notify(`正在执行 ${task.name} ...`, "warning");
      const result = await runTask(task, state.config.settings);
      await updateTask(task.id, (currentTask) =>
        markTaskResult(currentTask, result, { consumeSchedule: false })
      );
      notify(
        `${task.name} 执行完成，退出码 ${result.exitCode}`,
        result.exitCode === 0 ? "success" : "warning"
      );
      await refresh(true);
    } catch (error) {
      notify(error.message, "danger");
    }
  }

  async function toggleSelectedTask() {
    const task = getSelectedTask(state);
    if (!task) {
      notify("当前没有任务可操作", "warning");
      return;
    }

    try {
      const nextEnabled = !task.enabled;
      await updateTask(task.id, (currentTask) => toggleTask(currentTask, nextEnabled));
      notify(
        `${task.name} 已${nextEnabled ? "启用" : "停用"}`,
        nextEnabled ? "success" : "warning"
      );
      await refresh(true);
    } catch (error) {
      notify(error.message, "danger");
    }
  }

  async function deleteSelectedTask() {
    const task = getSelectedTask(state);
    if (!task) {
      notify("当前没有任务可删除", "warning");
      return;
    }

    state.modalOpen = true;
    try {
      const confirmed = await askConfirm(
        screen,
        "删除任务",
        `确定删除「${task.name}」吗？日志文件会保留。`
      );
      if (!confirmed) {
        return;
      }
      await removeTask(task.id);
      state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
      notify(`${task.name} 已删除`, "success");
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      state.modalOpen = false;
      await refresh(true);
    }
  }

  async function toggleDaemon() {
    try {
      if (state.daemon?.running) {
        await stopDetachedDaemon();
        notify("守护进程已停止", "warning");
      } else {
        await startDetachedDaemon();
        notify("守护进程已启动", "success");
      }
      await refresh(true);
    } catch (error) {
      notify(error.message, "danger");
    }
  }

  async function toggleService() {
    try {
      if (!state.service?.installed) {
        await installService();
        await startService();
        notify("系统服务已安装并启动", "success");
      } else if (state.service.active) {
        await stopService();
        notify("系统服务已停止", "warning");
      } else {
        await startService();
        notify("系统服务已启动", "success");
      }
      await refresh(true);
    } catch (error) {
      notify(error.message, "danger");
    }
  }

  async function openControlCenter() {
    state.modalOpen = true;
    try {
      await showSystemCenter(screen, state);
    } catch (error) {
      notify(error.message, "danger");
    } finally {
      state.modalOpen = false;
      await refresh(true);
    }
  }

  async function showHelp() {
    state.modalOpen = true;
    try {
      await showText(
        screen,
        "快捷键说明",
        [
          "n  新建计划任务",
          "s  快速启动任务",
          "e  编辑当前任务",
          "r  立即执行一次",
          "space  启用/停用任务",
          "x  删除任务",
          "d  启动/停止守护进程",
          "i  安装/启动或停止系统服务",
          "?  查看帮助",
          "q  退出界面",
          "",
          "界面说明：",
          "- 左侧是任务列表",
          "- 顶部控制坞只保留高频动作",
          "- 控制中心收纳 daemon / service",
          "- 右上显示任务摘要和执行状态",
          "- 中间显示提示词或命令说明",
          "- 右下是最近日志预览",
          "",
          "表单说明：",
          "- 新建和快速启动都会打开一个中文 sheet 表单",
          "- 快速启动默认隐藏高级选项",
          "- 保存并运行会立刻执行一次，但不会吞掉未来计划"
        ].join("\n")
      );
    } finally {
      state.modalOpen = false;
      await refresh(true);
    }
  }
}

async function openTaskEditor(screen, state, options = {}) {
  const settings = state.config?.settings || {};
  const existingTask = options.existingTask || null;
  const quick = Boolean(options.quick);
  const formState = buildFormState(existingTask, settings, { quick });
  const rows = [];
  let selectedIndex = 0;

  const overlay = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: {
      bg: "#030612",
      transparent: false
    }
  });

  const modal = blessed.box({
    parent: overlay,
    top: "center",
    left: "center",
    width: "84%",
    height: "84%",
    border: "line",
    label: ` ${existingTask ? "编辑任务" : quick ? "快速启动" : "新建任务"} `,
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: quick ? theme.accent : theme.border
      }
    }
  });

  blessed.box({
    parent: modal,
    top: 1,
    left: 2,
    width: "100%-4",
    height: 4,
    tags: true,
    content:
      `{bold}{${tagColors.accent}-fg}OpenTicker{/}{/bold} {${tagColors.dim}-fg}// 中文任务表单 · Sheet 模式{/}\n` +
      `${quick ? "只填核心字段就能启动，保存并运行不会吞掉未来计划。" : "核心字段优先，高级项默认收起；先建再细调。"}\n` +
      `{${tagColors.dim}-fg}模板、CLI 和触发方式都支持一键切换。{/}`
  });

  const fieldList = blessed.list({
    parent: modal,
    top: 6,
    left: 1,
    width: "48%",
    height: "100%-13",
    border: "line",
    label: " 表单 ",
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: theme.panelAlt,
      fg: theme.text,
      border: {
        fg: theme.border
      },
      selected: {
        fg: theme.bg,
        bg: theme.border,
        bold: true
      }
    }
  });

  const preview = blessed.box({
    parent: modal,
    top: 6,
    left: "49%",
    width: "51%-1",
    height: "100%-13",
    border: "line",
    label: " 实时预览 ",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: theme.panelAlt,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  const footerBar = createModalFooter(modal, {
    hint:
      `{${tagColors.dim}-fg}Esc 取消 · Enter 编辑字段 · Space 快切 · Ctrl+S 保存 · Ctrl+R 保存并运行{/}`
  });
  let submitting = false;

  const modalButtons = createButtonRow(
    footerBar,
    [
      { label: "取消", hotkey: "Esc", color: theme.danger, onPress: () => close(null) },
      { label: "保存", hotkey: "Ctrl+S", color: theme.border, onPress: () => void save(false) },
      { label: "保存并运行", hotkey: "Ctrl+R", color: theme.success, onPress: () => void save(true) }
    ],
    {
      top: 1,
      left: 2,
      right: 2,
      gap: 1,
      background: theme.panelAlt
    }
  );

  const setFooterHint = (message, level = "dim") => {
    if (!footerBar.hintBox) {
      return;
    }

    const colorMap = {
      dim: tagColors.dim,
      success: tagColors.success,
      warning: tagColors.warning,
      danger: tagColors.danger
    };
    footerBar.hintBox.setContent(`{${colorMap[level] || tagColors.dim}-fg}${message}{/}`);
  };

  const renderForm = () => {
    rows.splice(0, rows.length, ...buildFormRows(formState, { quick, editing: Boolean(existingTask) }));
    fieldList.setItems(rows.map((row) => formatFormRow(row, formState)));
    fieldList.select(Math.min(selectedIndex, rows.length - 1));
    preview.setContent(renderFormPreview(formState, rows[selectedIndex]));
    layoutButtonRow(footerBar, modalButtons, {
      top: 1,
      left: 2,
      right: 2,
      gap: 1
    });
    screen.render();
  };

  const close = (value) => {
    overlay.destroy();
    screen.render();
    resolver(value);
  };

  const save = async (runNow) => {
    if (submitting) {
      return;
    }

    submitting = true;
    setFooterHint(
      runNow ? "正在保存并执行，请稍候..." : "正在保存任务，请稍候...",
      "warning"
    );
    screen.render();

    try {
      const input = formStateToTaskInput(formState, existingTask, settings);
      const normalized = normalizeTask(input, settings, {
        preserveRuntime: Boolean(existingTask),
        preserveUpdatedAt: Boolean(existingTask)
      });

      let task;
      if (existingTask) {
        task = await updateTask(existingTask.id, () => normalized);
      } else {
        task = await addTask(normalized);
      }

      if (!runNow) {
        close({
          task,
          ranNow: false
        });
        return;
      }

      const result = await runTask(task, settings);
      const updatedTask = await updateTask(task.id, (currentTask) =>
        markTaskResult(currentTask, result, { consumeSchedule: false })
      );

      close({
        task: updatedTask,
        ranNow: true,
        exitCode: result.exitCode
      });
    } catch (error) {
      submitting = false;
      setFooterHint(error.message, "danger");
      screen.render();
    }
  };

  let resolver;
  const promise = new Promise((resolve) => {
    resolver = resolve;
  });

  fieldList.on("select", (_, index) => {
    selectedIndex = index;
    preview.setContent(renderFormPreview(formState, rows[selectedIndex]));
    screen.render();
  });

  fieldList.key(["enter"], async () => {
    await editSelectedRow();
  });
  fieldList.key(["space"], async () => {
    await editSelectedRow(true);
  });

  modal.key(["escape"], () => close(null));
  modal.key(["a"], () => {
    formState.advanced = !formState.advanced;
    selectedIndex = 0;
    renderForm();
  });
  modal.key(["C-s"], async () => {
    await save(false);
  });
  modal.key(["C-r"], async () => {
    await save(true);
  });

  async function editSelectedRow(quickCycle = false) {
    if (submitting) {
      return;
    }
    const row = rows[selectedIndex];
    if (!row) {
      return;
    }

    if (row.kind === "toggle") {
      row.apply(formState, quickCycle);
      renderForm();
      return;
    }

    if (row.kind === "cycle") {
      row.apply(formState, quickCycle);
      renderForm();
      return;
    }

    if (row.kind === "text") {
      const nextValue = await askInput(
        screen,
        row.label,
        String(row.read(formState) || ""),
        row.placeholder
      );
      if (nextValue !== null) {
        row.write(formState, nextValue);
        renderForm();
      }
      return;
    }

    if (row.kind === "textarea") {
      const nextValue = await askMultilineInput(
        screen,
        row.label,
        String(row.read(formState) || ""),
        row.placeholder
      );
      if (nextValue !== null) {
        row.write(formState, nextValue);
        renderForm();
      }
    }
  }

  fieldList.focus();
  renderForm();
  return promise;
}

function buildFormState(existingTask, settings, options = {}) {
  if (existingTask) {
    return {
      templateId: "custom",
      name: existingTask.name,
      description: existingTask.description || "",
      provider: existingTask.command.provider || settings.defaultProvider || "opencode",
      type: existingTask.type,
      scheduleValue: scheduleValueFromTask(existingTask),
      prompt: existingTask.command.prompt || "",
      workdir: existingTask.command.workdir || process.cwd(),
      enabled: existingTask.enabled,
      attachStrategy: existingTask.command.attachStrategy || "inherit",
      advanced: false,
      commandName: existingTask.command.commandName || "",
      model: existingTask.command.model || "",
      agent: existingTask.command.agent || "",
      title: existingTask.command.title || "",
      extraArgs: Array.isArray(existingTask.command.extraArgs)
        ? existingTask.command.extraArgs.join(" ")
        : ""
    };
  }

  const initialPresetId = options.quick ? "delay" : "heartbeat";
  return applyPreset(
    {
      templateId: initialPresetId,
      provider: settings.defaultProvider || "opencode",
      advanced: false
    },
    initialPresetId,
    settings
  );
}

function buildFormRows(formState, options = {}) {
  const rows = [
    cycleRow({
      key: "templateId",
      label: "任务模板",
      read: (state) => presetLabel(state.templateId),
      description:
        "快速替换整套默认内容。新建任务建议先用模板，再做少量修改。",
      apply: (state) => {
        const nextId = cycleValue(state.templateId, presetIds);
        const nextState = applyPreset(state, nextId, {});
        Object.assign(state, nextState);
      }
    }),
    cycleRow({
      key: "provider",
      label: "触发 CLI",
      read: (state) => providerLabel(state.provider),
      description: providerHelp(formState.provider),
      apply: (state) => {
        state.provider = cycleValue(state.provider, cliProviders);
      }
    }),
    textRow({
      key: "name",
      label: "任务名称",
      placeholder: "例如：每小时代码巡检",
      read: (state) => state.name,
      write: (state, value) => {
        state.name = value;
      },
      description: "任务列表里显示的名字，尽量简短明确。"
    }),
    cycleRow({
      key: "type",
      label: "任务类型",
      read: (state) => formatTaskType(state.type),
      description: "循环任务适合心跳，一次性适合定点触发，延时适合稍后跟进。",
      apply: (state) => {
        state.type = cycleValue(state.type, taskTypes);
        state.scheduleValue = defaultScheduleForType(state.type);
      }
    }),
    textRow({
      key: "scheduleValue",
      label: scheduleLabelForType(formState.type),
      placeholder: schedulePlaceholderForType(formState.type),
      read: (state) => state.scheduleValue,
      write: (state, value) => {
        state.scheduleValue = value;
      },
      description: scheduleHelpForType(formState.type)
    }),
    textRow({
      key: "workdir",
      label: "工作目录",
      placeholder: process.cwd(),
      read: (state) => state.workdir,
      write: (state, value) => {
        state.workdir = resolveWorkdir(value);
      },
      description: "所选 CLI 执行时所在目录。默认就是当前仓库。"
    }),
    textareaRow({
      key: "prompt",
      label: "提示词",
      placeholder: "描述要让 AI CLI 做什么",
      read: (state) => state.prompt,
      write: (state, value) => {
        state.prompt = value;
      },
      description:
        "这是最核心的字段。建议一句话说明目标，再补充输出要求。"
    }),
    toggleRow({
      key: "enabled",
      label: "启用任务",
      read: (state) => (state.enabled ? "已启用" : "已停用"),
      description: "关闭后任务仍然保留，但不会被调度器执行。",
      apply: (state) => {
        state.enabled = !state.enabled;
      }
    }),
    toggleRow({
      key: "advanced",
      label: "高级选项",
      read: (state) => (state.advanced ? "已展开" : "已折叠"),
      description: "展开后可以配置附着策略、模型、命令名和额外参数。",
      apply: (state) => {
        state.advanced = !state.advanced;
      }
    })
  ];

  if (!formState.advanced) {
    return rows;
  }

  if (formState.provider === "opencode") {
    rows.push(
      cycleRow({
        key: "attachStrategy",
        label: "附着策略",
        read: (state) => formatAttachStrategy(state.attachStrategy),
        description: "默认跟随全局；总是附着适合配合 `opencode serve`。",
        apply: (state) => {
          state.attachStrategy = cycleValue(state.attachStrategy, attachStrategies);
        }
      }),
      textRow({
        key: "commandName",
        label: "命令名",
        placeholder: "留空则走 prompt 模式",
        read: (state) => state.commandName,
        write: (state, value) => {
          state.commandName = value;
        },
        description: "OpenCode 命令别名。留空时直接执行 prompt。"
      }),
      textRow({
        key: "model",
        label: "模型",
        placeholder: "可留空",
        read: (state) => state.model,
        write: (state, value) => {
          state.model = value;
        },
        description: "需要固定模型时再填。"
      }),
      textRow({
        key: "agent",
        label: "Agent",
        placeholder: "可留空",
        read: (state) => state.agent,
        write: (state, value) => {
          state.agent = value;
        },
        description: "OpenCode 的 agent 名称。"
      }),
      textRow({
        key: "title",
        label: "会话标题",
        placeholder: "可留空",
        read: (state) => state.title,
        write: (state, value) => {
          state.title = value;
        },
        description: "便于之后在 OpenCode 会话里区分用途。"
      })
    );
  } else if (formState.provider === "claude") {
    rows.push(
      textRow({
        key: "model",
        label: "模型",
        placeholder: "例如：sonnet",
        read: (state) => state.model,
        write: (state, value) => {
          state.model = value;
        },
        description: "Claude Code 支持 `--model`。"
      }),
      textRow({
        key: "agent",
        label: "Agent",
        placeholder: "可留空",
        read: (state) => state.agent,
        write: (state, value) => {
          state.agent = value;
        },
        description: "Claude Code 支持 `--agent`。"
      }),
      textRow({
        key: "title",
        label: "会话标题",
        placeholder: "可留空",
        read: (state) => state.title,
        write: (state, value) => {
          state.title = value;
        },
        description: "Claude Code 会映射到 `--name`。"
      })
    );
  } else {
    rows.push(
      textRow({
        key: "model",
        label: "模型",
        placeholder: "例如：o3",
        read: (state) => state.model,
        write: (state, value) => {
          state.model = value;
        },
        description: "Codex CLI 支持 `codex exec --model`。"
      })
    );
  }

  rows.push(
    textRow({
      key: "extraArgs",
      label: "额外参数",
      placeholder: "--output-format json",
      read: (state) => state.extraArgs,
      write: (state, value) => {
        state.extraArgs = value;
      },
      description: "原样附加到所选 CLI。"
    }),
    textRow({
      key: "description",
      label: "任务说明",
      placeholder: "可留空",
      read: (state) => state.description,
      write: (state, value) => {
        state.description = value;
      },
      description: "给自己看的备注。"
    })
  );

  if (options.quick) {
    return rows;
  }

  return rows;
}

function formStateToTaskInput(formState, existingTask, settings) {
  const input = {
    ...(existingTask
      ? {
          id: existingTask.id,
          createdAt: existingTask.createdAt,
          updatedAt: existingTask.updatedAt,
          runtime: existingTask.runtime
        }
      : {}),
    name: formState.name,
    description: formState.description,
    type: formState.type,
    enabled: formState.enabled,
    overlapPolicy: "skip",
    schedule: {},
    command: {
      mode: formState.commandName ? "command" : "prompt",
      provider: formState.provider,
      prompt: formState.prompt,
      workdir: resolveWorkdir(formState.workdir || process.cwd()),
      attachStrategy: formState.attachStrategy || "inherit",
      extraArgs: formState.extraArgs || "",
      model: formState.model || "",
      agent: formState.agent || "",
      title: formState.title || formState.name,
      format: settings.outputMode || "pretty",
      commandName: formState.commandName || ""
    }
  };

  if (formState.type === "cron") {
    input.schedule.cron = formState.scheduleValue;
    input.schedule.timezone = settings.timezone;
  } else if (formState.type === "once") {
    input.schedule.at = formState.scheduleValue;
  } else {
    input.schedule.delayText = formState.scheduleValue;
  }

  return input;
}

function renderHeader(state) {
  const total = state.config?.tasks.length || 0;
  const enabled = state.config?.tasks.filter((task) => task.enabled).length || 0;
  const daemonLine = state.daemon?.running
    ? `{${tagColors.success}-fg}守护在线{/} {${tagColors.dim}-fg}pid ${state.daemon.pid}{/}`
    : `{${tagColors.warning}-fg}守护离线{/}`;
  const serviceLine = !state.service?.installed
    ? `{${tagColors.dim}-fg}服务未安装{/}`
    : state.service.active
      ? `{${tagColors.success}-fg}服务运行中{/}`
      : `{${tagColors.warning}-fg}服务已安装{/}`;
  const refreshed = state.lastRefreshAt
    ? dayjs(state.lastRefreshAt).format("HH:mm:ss")
    : "--:--:--";

  return [
    `{bold}{${tagColors.border}-fg}OPENTICKER{/}{/bold} {${tagColors.dim}-fg}// AI CLI Scheduler{/}`,
    `{${tagColors.dim}-fg}任务{/} {${tagColors.text}-fg}${enabled}/${total}{/}  {${tagColors.dim}-fg}·{/}  ${daemonLine}  {${tagColors.dim}-fg}·{/}  ${serviceLine}  {${tagColors.dim}-fg}· 刷新 ${refreshed}{/}`
  ].join("\n");
}

function renderTaskSummary(task) {
  if (!task) {
    return [
      `{${tagColors.dim}-fg}当前还没有任务。{/}`,
      "",
      "按 `n` 新建一个计划任务，或者按 `s` 用快速表单直接启动。",
      "",
      "推荐先试：",
      "- 每小时心跳",
      "- 每日仓库巡检",
      "- 延时跟进任务"
    ].join("\n");
  }

  const lines = [
    `{bold}${task.name}{/bold}`,
    `${task.description || "没有补充说明"}`,
    "",
    `${infoLabel("状态")} ${task.enabled ? "已启用" : "已停用"}`,
    `${infoLabel("CLI")} ${providerLabel(task.command.provider)}`,
    `${infoLabel("类型")} ${formatTaskType(task.type)}`,
    `${infoLabel("规则")} ${humanizeSchedule(task)}`,
    `${infoLabel("下次")} ${task.runtime.nextRunAt ? `${formatDateTime(task.runtime.nextRunAt)} / ${relativeToNow(task.runtime.nextRunAt)}` : "暂无"}`,
    `${infoLabel("目录")} ${task.command.workdir}`,
    `${infoLabel("附着")} ${formatAttachStrategy(task.command.attachStrategy)}`,
    `${infoLabel("模型")} ${task.command.model || "默认"}`,
    `${infoLabel("Agent")} ${task.command.agent || "默认"}`,
    `${infoLabel("命令")} ${task.command.commandName || "prompt 模式"}`,
    `${infoLabel("创建")} ${formatDateTime(task.createdAt)}`,
    `${infoLabel("更新")} ${formatDateTime(task.updatedAt)}`
  ];

  if (task.runtime.lastRunAt) {
    lines.push(
      "",
      `${infoLabel("上次执行")} ${formatDateTime(task.runtime.lastRunAt)}`,
      `${infoLabel("退出码")} ${String(task.runtime.lastExitCode)}`,
      `${infoLabel("耗时")} ${formatDuration(task.runtime.lastDurationMs)}`,
      `${infoLabel("执行次数")} ${String(task.runtime.runCount)}`,
      `${infoLabel("最近日志")} ${task.runtime.lastLogFile || "无"}`,
      `${infoLabel("最近错误")} ${task.runtime.lastError || "无"}`
    );
  }

  return lines.join("\n");
}

function renderPromptPanel(task) {
  if (!task) {
    return `{${tagColors.dim}-fg}选中一个任务后，这里会显示提示词或命令说明。{/}`;
  }

  const mode = task.command.commandName
    ? `命令模式：${task.command.commandName}`
    : "Prompt 模式";
  const prompt = task.command.prompt?.trim() || "未填写提示词";

  return [
    `${infoLabel("触发 CLI")} ${providerLabel(task.command.provider)}`,
    `${infoLabel("执行模式")} ${mode}`,
    "",
    prompt
  ].join("\n");
}

async function renderLogPanel(task) {
  if (!task?.runtime?.lastLogFile) {
    return `{${tagColors.dim}-fg}还没有执行日志。可以按 r 先运行一次看看。{/}`;
  }

  try {
    const content = await fs.readFile(task.runtime.lastLogFile, "utf8");
    return content.split("\n").slice(-26).join("\n");
  } catch {
    return `{${tagColors.warning}-fg}最近日志文件读取失败。{/}`;
  }
}

function renderFooter() {
  return [
    `{${tagColors.dim}-fg}[n] 新建  [s] 快启  [e] 编辑  [r] 执行  [space] 启停  [x] 删除  [d] 守护  [i] 服务  [?] 帮助  [q] 退出{/}`,
    `{${tagColors.dim}-fg}提示：主界面只保留高频动作，后台管理收进系统面板。{/}`
  ].join("\n");
}

function formatTaskListItem(task) {
  const dot = task.enabled
    ? `{${tagColors.success}-fg}●{/}`
    : `{${tagColors.dim}-fg}○{/}`;
  const name = truncate(task.name, 14);
  const type = truncate(formatTaskType(task.type), 4);
  const provider = truncate(providerLabel(task.command.provider), 7);
  const next = truncate(
    task.runtime.nextRunAt ? relativeToNow(task.runtime.nextRunAt) : "未启用",
    10
  );
  return `${dot} ${name}  {${tagColors.dim}-fg}${type}/${provider}{/}  {${tagColors.dim}-fg}${next}{/}`;
}

function renderFormPreview(formState, row) {
  const previewLines = [
    `{bold}${formState.name || "未命名任务"}{/bold}`,
    `${formState.description || "暂无任务说明"}`,
    "",
    `${infoLabel("模板")} ${presetLabel(formState.templateId)}`,
    `${infoLabel("CLI")} ${providerLabel(formState.provider)}`,
    `${infoLabel("类型")} ${formatTaskType(formState.type)}`,
    `${infoLabel("规则")} ${formState.scheduleValue}`,
    `${infoLabel("目录")} ${formState.workdir}`,
    `${infoLabel("附着")} ${formatAttachStrategy(formState.attachStrategy)}`,
    `${infoLabel("启用")} ${formState.enabled ? "是" : "否"}`,
    `${infoLabel("高级")} ${formState.advanced ? "展开" : "收起"}`,
    "",
    `${infoLabel("提示词")}`,
    formState.prompt || "未填写",
    ""
  ];

  if (row) {
    previewLines.push(
      `{${tagColors.accent}-fg}当前字段：${row.label}{/}`,
      row.description || "无说明",
      "",
      `${infoLabel("当前值")}`,
      truncateMultiline(String(row.read(formState) || ""), 12)
    );
  }

  previewLines.push(
    "",
    `{${tagColors.dim}-fg}表单操作{/}`,
    "- Enter 编辑当前字段",
    "- Space 快速切换枚举/开关",
    "- a 展开或收起高级选项",
    "- Ctrl+S 保存任务",
    "- Ctrl+R 保存并立即运行"
  );

  return previewLines.join("\n");
}

function createActionButtons(parent, actions) {
  const specs = [
    { label: "新建", hotkey: "N", onPress: actions.onCreate, color: theme.border },
    { label: "快启", hotkey: "S", onPress: actions.onQuickStart, color: theme.accent },
    { label: "编辑", hotkey: "E", onPress: actions.onEdit, color: theme.border },
    { label: "运行", hotkey: "R", onPress: actions.onRun, color: theme.success }
  ];

  return createButtonRow(parent, specs, {
    top: 2,
    left: 2,
    right: 2,
    gap: 1,
    showHotkeys: false,
    minWidth: 8
  });
}

function updateActionButtonLabels(buttons, state) {
  if (!buttons?.length) {
    return;
  }
  const task = getSelectedTask(state);

  if (buttons[2]) {
    buttons[2].setContent(task ? " 编辑 " : " 选择 ");
  }
  if (buttons[3]) {
    buttons[3].setContent(task ? " 运行 " : " 暂无 ");
  }
}

function createSystemButtons(parent, actions) {
  const specs = [
    { label: "系统", hotkey: "Enter", onPress: actions.onSystem, color: theme.accent }
  ];

  return createButtonRow(parent, specs, {
    top: 2,
    left: 2,
    right: 2,
    gap: 1,
    showHotkeys: false,
    minWidth: 8
  });
}

function updateSystemButtonLabels(buttons, hintBox, state) {
  if (hintBox) {
    const daemonText = state.daemon?.running ? "守护在线" : "守护离线";
    let serviceText = "服务未装";
    if (state.service?.installed) {
      serviceText = state.service.active ? "服务运行中" : "服务已安装";
    }
    hintBox.setContent(
      `{${tagColors.dim}-fg}${daemonText} · ${serviceText}{/}`
    );
  }

  if (!buttons?.length) {
    return;
  }
  buttons[0].setContent(" 系统 ");
}

function createModalFooter(parent, options = {}) {
  const footer = blessed.box({
    parent,
    bottom: 0,
    left: 1,
    width: "100%-2",
    height: 5,
    style: {
      bg: theme.panelAlt,
      fg: theme.dim
    }
  });

  if (options.hint) {
    footer.hintBox = blessed.box({
      parent: footer,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 1,
      tags: true,
      content: options.hint,
      style: {
        bg: theme.panelAlt,
        fg: theme.dim
      }
    });
  }

  return footer;
}

function createButtonRow(parent, specs, options = {}) {
  const buttons = specs.map((spec) => {
    const button = blessed.button({
      parent,
      top: options.top ?? 1,
      left: 0,
      width: 12,
      height: options.height || 3,
      mouse: true,
      keys: true,
      align: "center",
      valign: "middle",
      content:
        options.showHotkeys === false
          ? ` ${spec.label} `
          : ` ${spec.label}${spec.hotkey ? ` · ${spec.hotkey}` : ""} `,
      border: "line",
      style: buttonStyle(spec.color, options.background)
    });
    button.hotkey = spec.hotkey;
    button.baseLabel = spec.label;
    button.on("press", spec.onPress);
    return button;
  });

  layoutButtonRow(parent, buttons, options);
  return buttons;
}

function layoutButtonRow(parent, buttons, options = {}) {
  if (!parent || !buttons?.length) {
    return;
  }

  const gap = options.gap ?? 1;
  const left = options.left ?? 1;
  const right = options.right ?? 1;
  const minWidth = options.minWidth ?? 12;
  const parentWidth = resolveElementWidth(parent);
  const availableWidth = Math.max(
    parentWidth - left - right - gap * (buttons.length - 1),
    buttons.length * 6
  );
  const idealWidth = Math.floor(availableWidth / buttons.length);
  const buttonWidth =
    idealWidth >= minWidth ? idealWidth : Math.max(idealWidth, 6);

  buttons.forEach((button, index) => {
    button.top = options.top ?? 1;
    button.left = left + index * (buttonWidth + gap);
    button.width = buttonWidth;
  });
}

function resolveElementWidth(element) {
  if (!element) {
    return 0;
  }

  if (typeof element.width === "number") {
    return element.width;
  }

  const text = String(element.width || "").trim();
  const baseWidth = element.parent
    ? resolveElementWidth(element.parent)
    : Number(element.screen?.width || 0);

  const percentMatch = text.match(/^(\d+)%$/);
  if (percentMatch) {
    return Math.floor(baseWidth * Number(percentMatch[1]) / 100);
  }

  const percentOffsetMatch = text.match(/^(\d+)%([+-]\d+)$/);
  if (percentOffsetMatch) {
    return (
      Math.floor(baseWidth * Number(percentOffsetMatch[1]) / 100) +
      Number(percentOffsetMatch[2])
    );
  }

  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  return baseWidth;
}

function buttonStyle(color, background = theme.panel) {
  return {
    fg: theme.text,
    bg: background,
    border: {
      fg: color
    },
    focus: {
      fg: theme.text,
      bg: background,
      bold: true
    },
    hover: {
      fg: theme.text,
      bg: background,
      bold: true
    }
  };
}

function cycleRow(row) {
  return {
    ...row,
    kind: "cycle"
  };
}

function toggleRow(row) {
  return {
    ...row,
    kind: "toggle"
  };
}

function textRow(row) {
  return {
    ...row,
    kind: "text"
  };
}

function textareaRow(row) {
  return {
    ...row,
    kind: "textarea"
  };
}

function padLabel(label, width) {
  if (label.length >= width) {
    return label;
  }
  return `${label}${" ".repeat(width - label.length)}`;
}

async function askInput(screen, title, initial = "", placeholder = "") {
  const prompt = blessed.prompt({
    parent: screen,
    width: "70%",
    height: 9,
    top: "center",
    left: "center",
    label: ` ${title} `,
    border: "line",
    tags: true,
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.border
      }
    }
  });

  return new Promise((resolve) => {
    prompt.input(
      `${title}${placeholder ? `\n${placeholder}` : ""}`,
      initial,
      (_, value) => {
        prompt.destroy();
        screen.render();
        resolve(value ?? null);
      }
    );
    screen.render();
  });
}

async function askMultilineInput(screen, title, initial = "", placeholder = "") {
  const overlay = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: {
      bg: "#02040b"
    }
  });

  const modal = blessed.box({
    parent: overlay,
    top: "center",
    left: "center",
    width: "78%",
    height: "72%",
    label: ` ${title} `,
    border: "line",
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  blessed.box({
    parent: modal,
    top: 1,
    left: 2,
    width: "100%-4",
    height: 2,
    tags: true,
    content:
      `${placeholder || "输入完成后按 Ctrl+S 保存，按 Esc 取消。"}`
  });

  const editor = blessed.textarea({
    parent: modal,
    top: 3,
    left: 1,
    width: "100%-2",
    height: "100%-9",
    border: "line",
    keys: true,
    mouse: true,
    inputOnFocus: true,
    scrollbar: {
      ch: " ",
      style: {
        bg: theme.border
      }
    },
    style: {
      bg: theme.panelAlt,
      fg: theme.text,
      border: {
        fg: theme.border
      }
    }
  });
  editor.setValue(initial);

  const footerBar = createModalFooter(modal, {
    hint: `{${tagColors.dim}-fg}Esc 取消 · Ctrl+S 保存{/}`
  });

  let resolver;
  const promise = new Promise((resolve) => {
    resolver = resolve;
  });

  const close = (value) => {
    overlay.destroy();
    screen.render();
    resolver(value);
  };

  const footerButtons = createButtonRow(
    footerBar,
    [
      { label: "取消", hotkey: "Esc", color: theme.danger, onPress: () => close(null) },
      { label: "保存", hotkey: "Ctrl+S", color: theme.success, onPress: () => close(editor.getValue()) }
    ],
    {
      top: 1,
      left: 2,
      right: 2,
      gap: 1,
      background: theme.panelAlt
    }
  );

  editor.focus();
  modal.key(["escape"], () => close(null));
  modal.key(["C-s"], () => close(editor.getValue()));
  layoutButtonRow(footerBar, footerButtons, {
    top: 1,
    left: 2,
    right: 2,
    gap: 1
  });
  screen.render();

  return promise;
}

async function askConfirm(screen, title, body) {
  const overlay = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: {
      bg: "#02040b"
    }
  });

  const modal = blessed.box({
    parent: overlay,
    top: "center",
    left: "center",
    width: "56%",
    height: 11,
    label: ` ${title} `,
    border: "line",
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.warning
      }
    }
  });

  blessed.box({
    parent: modal,
    top: 1,
    left: 2,
    width: "100%-4",
    height: 3,
    content: body
  });

  let resolver;
  const promise = new Promise((resolve) => {
    resolver = resolve;
  });

  const close = (value) => {
    overlay.destroy();
    screen.render();
    resolver(value);
  };

  const footerBar = createModalFooter(modal, {
    hint: `{${tagColors.dim}-fg}Esc 取消 · Enter 确认{/}`
  });

  const footerButtons = createButtonRow(
    footerBar,
    [
      { label: "取消", hotkey: "Esc", color: theme.danger, onPress: () => close(false) },
      { label: "确定", hotkey: "Enter", color: theme.success, onPress: () => close(true) }
    ],
    {
      top: 1,
      left: 2,
      right: 2,
      gap: 1,
      background: theme.panelAlt
    }
  );

  modal.key(["escape"], () => close(false));
  modal.key(["enter"], () => close(true));
  layoutButtonRow(footerBar, footerButtons, {
    top: 1,
    left: 2,
    right: 2,
    gap: 1
  });
  footerButtons[1].focus();
  screen.render();
  return promise;
}

async function showText(screen, title, content) {
  const overlay = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: {
      bg: "#02040b"
    }
  });

  const modal = blessed.box({
    parent: overlay,
    top: "center",
    left: "center",
    width: "78%",
    height: "78%",
    label: ` ${title} `,
    border: "line",
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.border
      }
    }
  });

  const body = blessed.box({
    parent: modal,
    top: 1,
    left: 1,
    width: "100%-2",
    height: "100%-7",
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    tags: true,
    padding: {
      left: 1,
      right: 1
    },
    content,
    style: {
      bg: theme.panel,
      fg: theme.text
    }
  });

  const footerBar = createModalFooter(modal, {
    hint: `{${tagColors.dim}-fg}Esc / Enter / Q 关闭{/}`
  });

  const footerButtons = createButtonRow(
    footerBar,
    [{ label: "关闭", hotkey: "Esc", color: theme.border, onPress: () => close() }],
    {
      top: 1,
      left: 2,
      right: 2,
      gap: 1,
      background: theme.panelAlt
    }
  );

  const close = () => {
    overlay.destroy();
    screen.render();
    resolvePromise();
  };

  let resolvePromise = () => {};

  return new Promise((resolve) => {
    resolvePromise = resolve;
    modal.key(["escape", "q", "enter"], () => close());
    layoutButtonRow(footerBar, footerButtons, {
      top: 1,
      left: 2,
      right: 2,
      gap: 1
    });
    body.focus();
    screen.render();
  });
}

async function showSystemCenter(screen, state) {
  const overlay = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: {
      bg: "#02040b"
    }
  });

  const modal = blessed.box({
    parent: overlay,
    top: "center",
    left: "center",
    width: "62%",
    height: 17,
    label: " 控制中心 ",
    border: "line",
    style: {
      bg: theme.panel,
      fg: theme.text,
      border: {
        fg: theme.accent
      }
    }
  });

  blessed.box({
    parent: modal,
    top: 1,
    left: 2,
    width: "100%-4",
    height: 2,
    tags: true,
    content:
      `{bold}后台控制{/bold}\n{${tagColors.dim}-fg}把守护进程和系统服务都收进这里，主界面只保留高频任务动作。{/}`
  });

  const statusBox = blessed.box({
    parent: modal,
    top: 4,
    left: 1,
    width: "100%-2",
    height: 7,
    border: "line",
    label: " 状态 ",
    tags: true,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: theme.panelAlt,
      fg: theme.text,
      border: {
        fg: theme.border
      }
    }
  });

  let resolvePromise = () => {};
  const close = () => {
    overlay.destroy();
    screen.render();
    resolvePromise();
  };

  const footerBar = createModalFooter(modal, {
    hint: `{${tagColors.dim}-fg}Enter 执行按钮 · Esc 关闭{/}`
  });
  let busy = false;

  const footerButtons = createButtonRow(
    footerBar,
    [
      { label: "守护", hotkey: "D", color: theme.warning, onPress: () => void toggleDaemonInside() },
      { label: "服务", hotkey: "I", color: theme.border, onPress: () => void toggleServiceInside() },
      { label: "关闭", hotkey: "Esc", color: theme.accent, onPress: () => close() }
    ],
    {
      top: 1,
      left: 2,
      right: 2,
      gap: 1,
      background: theme.panelAlt
    }
  );

  const setFooterHint = (message, level = "dim") => {
    if (!footerBar.hintBox) {
      return;
    }

    const colorMap = {
      dim: tagColors.dim,
      success: tagColors.success,
      warning: tagColors.warning,
      danger: tagColors.danger
    };
    footerBar.hintBox.setContent(`{${colorMap[level] || tagColors.dim}-fg}${message}{/}`);
  };

  function renderStatus() {
    const daemon = state.daemon || { running: false };
    const service = state.service || { installed: false, active: false };

    const daemonLine = daemon.running
      ? `{${tagColors.success}-fg}在线{/}  pid ${daemon.pid || "-"}`
      : `{${tagColors.warning}-fg}离线{/}`;

    let serviceLine = `{${tagColors.warning}-fg}未安装{/}`;
    if (service.installed) {
      serviceLine = service.active
        ? `{${tagColors.success}-fg}已启动{/}`
        : `{${tagColors.warning}-fg}已安装未启动{/}`;
    }

    statusBox.setContent(
      [
        `${infoLabel("守护进程")} ${daemonLine}`,
        `${infoLabel("系统服务")} ${serviceLine}`,
        "",
        `${infoLabel("建议")}`,
        "- 日常开发临时跑任务，用守护进程更轻。",
        "- 想开机后也自动常驻，用系统服务。",
        "- 删除任务和帮助说明保留在主界面快捷键。"
      ].join("\n")
    );

    footerButtons[0].setContent(
      daemon.running ? " 停止守护 · D " : " 启动守护 · D "
    );

    if (!service.installed) {
      footerButtons[1].setContent(" 安装服务 · I ");
    } else if (service.active) {
      footerButtons[1].setContent(" 停止服务 · I ");
    } else {
      footerButtons[1].setContent(" 启动服务 · I ");
    }

    layoutButtonRow(footerBar, footerButtons, {
      top: 1,
      left: 2,
      right: 2,
      gap: 1
    });
    screen.render();
  }

  async function refreshState() {
    state.daemon = await getDaemonStatus();
    state.service = await getServiceStatus();
    renderStatus();
  }

  async function toggleDaemonInside() {
    if (busy) {
      return;
    }

    busy = true;
    setFooterHint("正在更新守护进程状态...", "warning");
    screen.render();
    try {
      if (state.daemon?.running) {
        await stopDetachedDaemon();
      } else {
        await startDetachedDaemon();
      }
      await refreshState();
      setFooterHint("守护进程状态已更新。", "success");
    } catch (error) {
      setFooterHint(error.message, "danger");
      screen.render();
    } finally {
      busy = false;
    }
  }

  async function toggleServiceInside() {
    if (busy) {
      return;
    }

    busy = true;
    setFooterHint("正在更新系统服务状态...", "warning");
    screen.render();
    try {
      if (!state.service?.installed) {
        await installService();
        await startService();
      } else if (state.service.active) {
        await stopService();
      } else {
        await startService();
      }
      await refreshState();
      setFooterHint("系统服务状态已更新。", "success");
    } catch (error) {
      setFooterHint(error.message, "danger");
      screen.render();
    } finally {
      busy = false;
    }
  }

  await refreshState();

  return new Promise((resolve) => {
    resolvePromise = resolve;
    modal.key(["escape", "q"], () => close());
    modal.key(["d"], () => {
      void toggleDaemonInside();
    });
    modal.key(["i"], () => {
      void toggleServiceInside();
    });
    footerButtons[2].focus();
    screen.render();
  });
}

function buildPresetInput(presetId, settings = {}) {
  const timezone =
    settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const provider = settings.defaultProvider || "opencode";
  const workdir = process.cwd();

  if (presetId === "daily") {
    return {
      name: "每日巡检",
      description: "每天自动扫描仓库变化并给出处理建议。",
      provider,
      type: "cron",
      scheduleValue: "30 9 * * *",
      prompt:
        "检查当前仓库变化、风险和待办，输出一份简短的今日行动建议，控制在 8 条以内。",
      workdir,
      enabled: true,
      attachStrategy: "inherit",
      commandName: "",
      model: "",
      agent: "",
      title: "每日巡检",
      extraArgs: "",
      timezone
    };
  }

  if (presetId === "once") {
    return {
      name: "一次性检查",
      description: "在固定时间执行一次任务。",
      provider,
      type: "once",
      scheduleValue: dayjs().add(1, "hour").format("YYYY-MM-DD HH:mm"),
      prompt:
        "对当前工作区做一次完整检查，重点列出阻塞项、风险项和下一步建议。",
      workdir,
      enabled: true,
      attachStrategy: "inherit",
      commandName: "",
      model: "",
      agent: "",
      title: "一次性检查",
      extraArgs: "",
      timezone
    };
  }

  if (presetId === "delay") {
    return {
      name: "延时跟进",
      description: "延迟一段时间后自动再检查一次。",
      provider,
      type: "delay",
      scheduleValue: "30m",
      prompt:
        "在等待周期结束后再次检查当前工作区，说明这段时间里发生了什么变化，以及是否需要继续动作。",
      workdir,
      enabled: true,
      attachStrategy: "inherit",
      commandName: "",
      model: "",
      agent: "",
      title: "延时跟进",
      extraArgs: "",
      timezone
    };
  }

  return {
    name: "每小时心跳",
    description: "保持默认 AI CLI 温热，并定期总结工作区状态。",
    provider,
    type: "cron",
    scheduleValue: "0 * * * *",
    prompt:
      "检查当前工作区，简短总结最近变化、潜在风险和建议动作，保持输出精炼。",
    workdir,
    enabled: true,
    attachStrategy: "always",
    commandName: "",
    model: "",
    agent: "",
    title: "每小时心跳",
    extraArgs: "",
    timezone
  };
}

function applyPreset(formState, presetId, settings = {}) {
  const preset = buildPresetInput(presetId, settings);
  return {
    ...formState,
    templateId: presetId,
    provider: formState.provider || preset.provider,
    name: preset.name,
    description: preset.description,
    type: preset.type,
    scheduleValue: preset.scheduleValue,
    prompt: preset.prompt,
    workdir: preset.workdir,
    enabled: preset.enabled,
    attachStrategy: preset.attachStrategy,
    commandName: preset.commandName,
    model: preset.model,
    agent: preset.agent,
    title: preset.title,
    extraArgs: preset.extraArgs
  };
}

function presetLabel(presetId) {
  if (presetId === "daily") {
    return "每日巡检";
  }
  if (presetId === "once") {
    return "一次性检查";
  }
  if (presetId === "delay") {
    return "延时跟进";
  }
  if (presetId === "custom") {
    return "自定义";
  }
  return "每小时心跳";
}

function scheduleValueFromTask(task) {
  if (task.type === "cron") {
    return task.schedule.cron;
  }
  if (task.type === "once") {
    return dayjs(task.schedule.at).format("YYYY-MM-DD HH:mm");
  }
  return task.schedule.delayText || formatDelay(task.schedule.delayMs);
}

function scheduleLabelForType(type) {
  if (type === "once") {
    return "执行时间";
  }
  if (type === "delay") {
    return "延时时间";
  }
  return "执行规则";
}

function schedulePlaceholderForType(type) {
  if (type === "once") {
    return "例如：2026-03-19 21:30";
  }
  if (type === "delay") {
    return "例如：30m、2h、1d";
  }
  return "例如：0 * * * *";
}

function scheduleHelpForType(type) {
  if (type === "once") {
    return "格式建议为 YYYY-MM-DD HH:mm。到点后只执行一次。";
  }
  if (type === "delay") {
    return "支持 30m、2h、1d 这类写法。保存时会换算成绝对时间。";
  }
  return "标准 cron 表达式。比如 `0 * * * *` 代表每小时整点。";
}

function defaultScheduleForType(type) {
  if (type === "once") {
    return dayjs().add(1, "hour").format("YYYY-MM-DD HH:mm");
  }
  if (type === "delay") {
    return "30m";
  }
  return "0 * * * *";
}

function formatTaskType(type) {
  if (type === "once") {
    return "一次性";
  }
  if (type === "delay") {
    return "延时";
  }
  return "循环";
}

function formatAttachStrategy(strategy) {
  if (strategy === "always") {
    return "总是附着";
  }
  if (strategy === "never") {
    return "从不附着";
  }
  return "跟随全局";
}

function cycleValue(currentValue, values) {
  const index = values.indexOf(currentValue);
  if (index < 0) {
    return values[0];
  }
  return values[(index + 1) % values.length];
}

function getSelectedTask(state) {
  return state.config?.tasks?.[state.selectedIndex] || null;
}

function infoLabel(text) {
  return `{${tagColors.dim}-fg}${text}{/}`;
}

function truncate(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function truncateMultiline(value, maxLines) {
  const lines = String(value || "").split("\n");
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  return `${lines.slice(0, maxLines).join("\n")}\n…`;
}

function formatFormRow(row, formState) {
  const label = padLabel(row.label, 10);
  const value = truncate(row.read(formState), 34);
  return `${label}  ${value}`;
}
