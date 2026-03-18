import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTask, toggleTask, shouldRunTask, markTaskResult } from "../src/tasks.js";

test("normalizeTask creates a delay task with computed next run", () => {
  const task = normalizeTask(
    {
      name: "Delayed job",
      type: "delay",
      schedule: {
        delayText: "15m"
      },
      command: {
        prompt: "hello"
      }
    },
    {
      timezone: "Asia/Shanghai"
    }
  );

  assert.equal(task.type, "delay");
  assert.equal(task.enabled, true);
  assert.match(task.runtime.nextRunAt, /^20/);
});

test("toggleTask disables and clears nextRunAt", () => {
  const task = normalizeTask(
    {
      name: "Hourly",
      type: "cron",
      schedule: {
        cron: "0 * * * *",
        timezone: "Asia/Shanghai"
      },
      command: {
        prompt: "hello"
      }
    },
    {
      timezone: "Asia/Shanghai"
    }
  );

  const disabled = toggleTask(task, false);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.runtime.nextRunAt, null);
});

test("shouldRunTask is true when next run is in the past", () => {
  const task = normalizeTask(
    {
      name: "One-shot",
      type: "once",
      schedule: {
        at: "2026-03-18 10:00"
      },
      command: {
        prompt: "hello"
      }
    },
    {}
  );

  task.runtime.nextRunAt = "2026-03-18T01:59:00.000Z";
  assert.equal(shouldRunTask(task, new Date("2026-03-18T02:00:00.000Z")), true);
});

test("markTaskResult disables one-shot tasks after execution", () => {
  const task = normalizeTask(
    {
      name: "Run once",
      type: "once",
      schedule: {
        at: "2026-03-18 10:00"
      },
      command: {
        prompt: "hello"
      }
    },
    {}
  );

  const updated = markTaskResult(task, {
    startedAt: "2026-03-18T02:00:00.000Z",
    finishedAt: "2026-03-18T02:00:10.000Z",
    durationMs: 10000,
    exitCode: 0,
    error: null,
    logFile: "/tmp/test.log",
    outputPreview: "ok"
  });

  assert.equal(updated.enabled, false);
  assert.equal(updated.runtime.nextRunAt, null);
  assert.equal(updated.runtime.lastExitCode, 0);
});

test("markTaskResult can preserve schedule for manual immediate runs", () => {
  const task = normalizeTask(
    {
      name: "Delayed follow-up",
      type: "delay",
      schedule: {
        delayText: "30m"
      },
      command: {
        prompt: "hello"
      }
    },
    {}
  );

  const previousNextRun = task.runtime.nextRunAt;
  const updated = markTaskResult(
    task,
    {
      startedAt: "2026-03-18T02:00:00.000Z",
      finishedAt: "2026-03-18T02:00:10.000Z",
      durationMs: 10000,
      exitCode: 0,
      error: null,
      logFile: "/tmp/test.log",
      outputPreview: "ok"
    },
    {
      consumeSchedule: false
    }
  );

  assert.equal(updated.enabled, true);
  assert.equal(updated.runtime.lastExitCode, 0);
  assert.equal(updated.runtime.nextRunAt, previousNextRun);
});
