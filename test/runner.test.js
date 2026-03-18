import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskInvocation } from "../src/runner.js";

const baseSettings = {
  defaultProvider: "opencode",
  cliCommands: {
    opencode: "npx -y opencode-ai",
    codex: "npx -y @openai/codex",
    claude: "npx -y @anthropic-ai/claude-code"
  },
  attachUrl: "http://127.0.0.1:4096",
  autoAttach: true,
  outputMode: "pretty"
};

test("buildTaskInvocation maps OpenCode tasks to opencode run", () => {
  const invocation = buildTaskInvocation(
    {
      name: "Hourly Heartbeat",
      command: {
        provider: "opencode",
        commandName: "heartbeat",
        continueLast: true,
        session: "session-1",
        model: "gpt-5",
        agent: "ops",
        title: "Heartbeat",
        format: "json",
        attachStrategy: "always",
        extraArgs: ["--profile", "nightly"],
        prompt: "Inspect the workspace."
      }
    },
    baseSettings
  );

  assert.equal(invocation.command, "npx");
  assert.deepEqual(invocation.args, [
    "-y",
    "opencode-ai",
    "run",
    "--command",
    "heartbeat",
    "--continue",
    "--session",
    "session-1",
    "--model",
    "gpt-5",
    "--agent",
    "ops",
    "--title",
    "Heartbeat",
    "--format",
    "json",
    "--attach",
    "http://127.0.0.1:4096",
    "--profile",
    "nightly",
    "Inspect the workspace."
  ]);
});

test("buildTaskInvocation maps Codex tasks to codex exec", () => {
  const invocation = buildTaskInvocation(
    {
      name: "Codex Review",
      command: {
        provider: "codex",
        model: "o3",
        format: "json",
        extraArgs: ["--sandbox", "workspace-write"],
        prompt: "Review the current repo."
      }
    },
    baseSettings
  );

  assert.equal(invocation.command, "npx");
  assert.deepEqual(invocation.args, [
    "-y",
    "@openai/codex",
    "exec",
    "--model",
    "o3",
    "--json",
    "--sandbox",
    "workspace-write",
    "Review the current repo."
  ]);
});

test("buildTaskInvocation maps Claude Code tasks to claude --print", () => {
  const invocation = buildTaskInvocation(
    {
      name: "Claude Follow-up",
      command: {
        provider: "claude",
        model: "sonnet",
        agent: "reviewer",
        title: "Follow-up",
        format: "json",
        extraArgs: ["--verbose"],
        prompt: "Check the repository again."
      }
    },
    baseSettings
  );

  assert.equal(invocation.command, "npx");
  assert.deepEqual(invocation.args, [
    "-y",
    "@anthropic-ai/claude-code",
    "--print",
    "--model",
    "sonnet",
    "--agent",
    "reviewer",
    "--name",
    "Follow-up",
    "--output-format",
    "json",
    "--verbose",
    "Check the repository again."
  ]);
});
