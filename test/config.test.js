import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig } from "../src/config.js";
import { normalizeTask, shouldRunTask } from "../src/tasks.js";

test("normalizeTask preserves stored next run metadata when requested", () => {
  const nextRunAt = "2026-03-18T10:00:00.000Z";
  const updatedAt = "2026-03-18T09:30:00.000Z";
  const task = normalizeTask(
    {
      id: "cron-keepalive",
      name: "Hourly Keepalive",
      type: "cron",
      schedule: {
        cron: "0 * * * *",
        timezone: "UTC"
      },
      command: {
        prompt: "hello"
      },
      createdAt: "2026-03-18T09:00:00.000Z",
      updatedAt,
      runtime: {
        nextRunAt,
        runCount: 4
      }
    },
    {
      timezone: "UTC"
    },
    {
      preserveRuntime: true,
      preserveUpdatedAt: true
    }
  );

  assert.equal(task.updatedAt, updatedAt);
  assert.equal(task.runtime.nextRunAt, nextRunAt);
  assert.equal(
    shouldRunTask(task, new Date("2026-03-18T10:00:01.000Z")),
    true
  );
});

test("normalizeConfig rejects duplicate task ids", () => {
  assert.throws(
    () =>
      normalizeConfig(
        {
          tasks: [
            {
              id: "dup-task",
              name: "Daily sweep",
              type: "cron",
              schedule: {
                cron: "0 9 * * *",
                timezone: "UTC"
              },
              command: {
                prompt: "first"
              }
            },
            {
              id: "dup-task",
              name: "Release gate",
              type: "once",
              schedule: {
                at: "2026-03-18 10:00"
              },
              command: {
                prompt: "second"
              }
            }
          ]
        },
        {
          preserveTaskState: true,
          preserveTaskUpdatedAt: true
        }
      ),
    /Duplicate task id: dup-task/
  );
});

test("normalizeConfig applies the default provider to tasks", () => {
  const config = normalizeConfig({
    settings: {
      defaultProvider: "codex",
      cliCommands: {
        codex: "npx -y @openai/codex"
      }
    },
    tasks: [
      {
        name: "Daily Codex Sweep",
        type: "cron",
        schedule: {
          cron: "0 9 * * *",
          timezone: "UTC"
        },
        command: {
          prompt: "Review the repo."
        }
      }
    ]
  });

  assert.equal(config.settings.defaultProvider, "codex");
  assert.equal(config.settings.cliCommands.codex, "npx -y @openai/codex");
  assert.equal(config.tasks[0].command.provider, "codex");
});

test("normalizeConfig supports legacy provider command keys", () => {
  const config = normalizeConfig({
    settings: {
      opencodeCommand: "opencode-beta",
      codexCommand: "npx -y @openai/codex",
      claudeCommand: "npx -y @anthropic-ai/claude-code"
    }
  });

  assert.equal(config.settings.cliCommands.opencode, "opencode-beta");
  assert.equal(config.settings.cliCommands.codex, "npx -y @openai/codex");
  assert.equal(
    config.settings.cliCommands.claude,
    "npx -y @anthropic-ai/claude-code"
  );
});
