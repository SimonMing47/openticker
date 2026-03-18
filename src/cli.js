import fs from "node:fs/promises";
import { Command } from "commander";
import {
  buildTaskFromCli,
  markTaskResult,
  taskToLine,
  toggleTask
} from "./tasks.js";
import {
  addTask,
  getTask,
  listLogs,
  loadConfig,
  removeTask,
  saveConfig,
  updateTask
} from "./store.js";
import { normalizeConfig, summarizeConfig } from "./config.js";
import { runTask } from "./runner.js";
import {
  getDaemonStatus,
  runDaemonLoop,
  startDetachedDaemon,
  stopDetachedDaemon
} from "./daemon.js";
import {
  getServiceStatus,
  installService,
  startService,
  stopService,
  uninstallService
} from "./service.js";
import { runDoctor } from "./doctor.js";
import { humanizeSchedule } from "./time.js";
import { formatDateTime, formatDuration } from "./utils.js";
import { startTui } from "./tui.js";

export async function runCli(argv = process.argv) {
  const program = new Command();
  program
    .name("openticker")
    .description("Schedule recurring, one-shot, and delayed OpenCode jobs.")
    .showHelpAfterError();

  program
    .command("tui")
    .description("Launch the OpenTicker full-screen TUI")
    .action(async () => {
      await startTui();
    });

  program
    .command("list")
    .description("List configured tasks")
    .action(async () => {
      const config = await loadConfig();
      for (const task of config.tasks) {
        process.stdout.write(
          `${taskToLine(task)} | next=${task.runtime.nextRunAt || "n/a"} | ${humanizeSchedule(task)}\n`
        );
      }
    });

  program
    .command("show")
    .argument("<taskId>", "task id")
    .description("Show a task in JSON")
    .action(async (taskId) => {
      const task = await getTask(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
    });

  program
    .command("add")
    .description("Create a task without opening the TUI")
    .requiredOption("--name <name>", "task name")
    .requiredOption("--type <type>", "cron | once | delay")
    .option("--description <description>", "task description")
    .option("--cron <cron>", "cron expression")
    .option("--timezone <timezone>", "IANA timezone")
    .option("--at <date>", "one-shot datetime, e.g. 2026-03-18T10:00")
    .option("--delay <delay>", "delay, e.g. 30m or 2h")
    .option("--prompt <prompt>", "prompt text for opencode")
    .option("--command-name <name>", "OpenCode command name")
    .option("--workdir <path>", "working directory")
    .option("--model <model>", "OpenCode model")
    .option("--agent <agent>", "OpenCode agent")
    .option("--title <title>", "OpenCode session title")
    .option("--attach <mode>", "inherit | always | never", "inherit")
    .option("--format <format>", "pretty | json", "pretty")
    .option("--session <id>", "OpenCode session id")
    .option("--continue-last", "continue the last OpenCode session")
    .option("--extra-args <value...>", "extra raw args passed to opencode run")
    .option("--disabled", "create the task disabled")
    .action(async (options) => {
      const config = await loadConfig();
      const task = buildTaskFromCli(options, config.settings);
      await addTask(task);
      process.stdout.write(`Created task ${task.id}\n`);
    });

  program
    .command("toggle")
    .argument("<taskId>", "task id")
    .option("--on", "force enable")
    .option("--off", "force disable")
    .description("Toggle a task enabled state")
    .action(async (taskId, options) => {
      const updated = await updateTask(taskId, (task) =>
        toggleTask(task, options.on ? true : options.off ? false : !task.enabled)
      );
      if (!updated) {
        throw new Error(`Task not found: ${taskId}`);
      }
      process.stdout.write(`${updated.id} => ${updated.enabled ? "enabled" : "disabled"}\n`);
    });

  program
    .command("remove")
    .argument("<taskId>", "task id")
    .description("Delete a task")
    .action(async (taskId) => {
      const removed = await removeTask(taskId);
      if (!removed) {
        throw new Error(`Task not found: ${taskId}`);
      }
      process.stdout.write(`Removed ${taskId}\n`);
    });

  program
    .command("run")
    .argument("<taskId>", "task id")
    .description("Run a task immediately")
    .action(async (taskId) => {
      const config = await loadConfig();
      const task = config.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      const result = await runTask(task, config.settings);
      await updateTask(taskId, (currentTask) => markTaskResult(currentTask, result));
      process.stdout.write(
        `Run finished exit=${result.exitCode} duration=${formatDuration(result.durationMs)} log=${result.logFile}\n`
      );
    });

  program
    .command("logs")
    .argument("<taskId>", "task id")
    .description("List task log files")
    .action(async (taskId) => {
      const logs = await listLogs(taskId);
      for (const log of logs) {
        process.stdout.write(`${log}\n`);
      }
    });

  const daemon = program.command("daemon").description("Manage the local detached daemon");
  daemon
    .command("run")
    .description("Run the scheduler loop in the foreground")
    .action(async () => {
      await runDaemonLoop();
    });
  daemon
    .command("start")
    .description("Start the local detached daemon")
    .action(async () => {
      const status = await startDetachedDaemon();
      process.stdout.write(`Daemon running pid=${status.pid}\n`);
    });
  daemon
    .command("stop")
    .description("Stop the local detached daemon")
    .action(async () => {
      const stopped = await stopDetachedDaemon();
      process.stdout.write(`${stopped ? "Stopped" : "Not running"}\n`);
    });
  daemon
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      const status = await getDaemonStatus();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    });

  const service = program.command("service").description("Manage the auto-start system service");
  service
    .command("install")
    .description("Install the service definition")
    .action(async () => {
      const descriptor = await installService();
      process.stdout.write(`Installed service at ${descriptor.filePath}\n`);
    });
  service
    .command("start")
    .description("Start the installed service")
    .action(async () => {
      await startService();
      process.stdout.write("Service started\n");
    });
  service
    .command("stop")
    .description("Stop the installed service")
    .action(async () => {
      await stopService();
      process.stdout.write("Service stopped\n");
    });
  service
    .command("status")
    .description("Show service status")
    .action(async () => {
      const status = await getServiceStatus();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    });
  service
    .command("uninstall")
    .description("Remove the installed service")
    .action(async () => {
      const removed = await uninstallService();
      process.stdout.write(`${removed ? "Service removed" : "Service not installed"}\n`);
    });

  program
    .command("doctor")
    .description("Check Node, OpenCode, config, daemon, and service status")
    .option("--strict", "fail if required dependencies are missing")
    .action(async (options) => {
      const checks = await runDoctor(options);
      for (const check of checks) {
        process.stdout.write(
          `${check.ok ? "OK" : "!!"} ${check.name.padEnd(12)} ${check.details}\n`
        );
      }
    });

  program
    .command("export")
    .argument("[file]", "output file")
    .description("Export the current config to stdout or a file")
    .action(async (file) => {
      const config = await loadConfig();
      const content = `${JSON.stringify(config, null, 2)}\n`;
      if (!file) {
        process.stdout.write(content);
        return;
      }
      await fs.writeFile(file, content, "utf8");
      process.stdout.write(`Wrote ${file}\n`);
    });

  program
    .command("import")
    .argument("<file>", "JSON file")
    .description("Replace config with an imported JSON config")
    .action(async (file) => {
      const raw = await fs.readFile(file, "utf8");
      const value = JSON.parse(raw);
      const config = normalizeConfig(value, {
        preserveConfigUpdatedAt: true,
        preserveTaskState: true,
        preserveTaskUpdatedAt: true
      });
      await saveConfig(config);
      const summary = summarizeConfig(config);
      process.stdout.write(
        `Imported ${file} (${summary.totalTasks} tasks, ${summary.enabledTasks} enabled)\n`
      );
    });

  if (argv.length <= 2) {
    await startTui();
    return;
  }

  await program.parseAsync(argv);
}
