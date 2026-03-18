import os from "node:os";
import path from "node:path";
import { DEFAULT_CLI_COMMANDS } from "./providers.js";

const home = os.homedir();
const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
const xdgDataHome =
  process.env.XDG_DATA_HOME || path.join(home, ".local", "share");

export const APP_NAME = "OpenTicker";
export const PACKAGE_NAME = "openticker";
export const DEFAULT_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const CONFIG_DIR = path.join(xdgConfigHome, PACKAGE_NAME);
export const DATA_DIR = path.join(xdgDataHome, PACKAGE_NAME);
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const LOG_DIR = path.join(DATA_DIR, "logs");
export const RUNTIME_DIR = path.join(DATA_DIR, "runtime");
export const PID_PATH = path.join(RUNTIME_DIR, "daemon.pid");
export const STATE_PATH = path.join(RUNTIME_DIR, "daemon-state.json");
export const SERVICE_NAME = "ai.openticker.agent";
export const DEFAULT_ATTACH_URL = "http://127.0.0.1:4096";
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_TASK_TIMEOUT_MS = 1000 * 60 * 20;
export const DEFAULT_CONFIG = {
  version: 1,
  settings: {
    timezone: DEFAULT_TIMEZONE,
    defaultProvider: "opencode",
    cliCommands: {
      ...DEFAULT_CLI_COMMANDS
    },
    attachUrl: DEFAULT_ATTACH_URL,
    autoAttach: true,
    autoStartDaemon: false,
    outputMode: "pretty",
    maxConcurrentRuns: 1
  },
  tasks: [
    {
      id: "sample-hourly-keepalive",
      name: "每小时心跳",
      description:
        "一个示例循环任务，用来保持默认 AI CLI 处于温热状态并定期总结工作区。",
      type: "cron",
      schedule: {
        cron: "0 * * * *",
        timezone: DEFAULT_TIMEZONE
      },
      command: {
        provider: "opencode",
        mode: "prompt",
        prompt:
          "检查当前工作区，简短总结最近变化、潜在风险和下一步建议，保持输出精炼。",
        workdir: process.cwd(),
        attachStrategy: "always",
        extraArgs: [],
        format: "pretty"
      },
      enabled: false,
      overlapPolicy: "skip",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runtime: {
        runCount: 0,
        lastRunAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        nextRunAt: null,
        lastError: null,
        lastLogFile: null
      }
    }
  ]
};
