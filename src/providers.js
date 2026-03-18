import { splitArgs } from "./utils.js";

export const SUPPORTED_PROVIDERS = ["opencode", "codex", "claude"];

export const DEFAULT_CLI_COMMANDS = {
  opencode: "opencode",
  codex: "codex",
  claude: "claude"
};

export function normalizeProvider(value, fallback = "opencode") {
  const provider = String(value || fallback || "opencode").trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported provider: ${value}`);
  }
  return provider;
}

export function providerLabel(provider) {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude Code";
    default:
      return "OpenCode";
  }
}

export function providerHelp(provider) {
  switch (provider) {
    case "codex":
      return "使用 `codex exec` 非交互执行任务。";
    case "claude":
      return "使用 `claude -p` 非交互执行任务。";
    default:
      return "使用 `opencode run` 执行任务。";
  }
}

export function providerCommand(settings, provider) {
  const selected = normalizeProvider(provider, settings?.defaultProvider || "opencode");
  const commands = settings?.cliCommands || DEFAULT_CLI_COMMANDS;
  const command = String(
    commands[selected] || DEFAULT_CLI_COMMANDS[selected] || ""
  ).trim();
  if (!String(command || "").trim()) {
    throw new Error(`CLI command is empty for provider: ${selected}`);
  }
  return command;
}

export function providerExecutable(settings, provider) {
  const raw = providerCommand(settings, provider);
  const parts = splitArgs(raw);
  if (parts.length === 0) {
    throw new Error(`CLI command is empty for provider: ${provider}`);
  }
  return {
    raw,
    command: parts[0],
    args: parts.slice(1)
  };
}
