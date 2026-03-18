import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/openticker.js", import.meta.url));

test("cli import normalizes and validates the saved config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openticker-import-"));
  const importFile = path.join(tempDir, "tasks.json");
  const xdgConfigHome = path.join(tempDir, "config");
  const xdgDataHome = path.join(tempDir, "data");

  await fs.writeFile(
    importFile,
    `${JSON.stringify(
      {
        version: 1,
        settings: {
          maxConcurrentRuns: "2",
          outputMode: "json"
        },
        tasks: [
          {
            id: "hourly-heartbeat",
            name: "Hourly Heartbeat",
            type: "cron",
            schedule: {
              cron: "0 * * * *",
              timezone: "UTC"
            },
            command: {
              prompt: "Inspect and summarize."
            },
            enabled: true
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const result = await execFileAsync(process.execPath, [cliPath, "import", importFile], {
    cwd: path.dirname(cliPath),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome
    }
  });

  const savedConfig = JSON.parse(
    await fs.readFile(
      path.join(xdgConfigHome, "openticker", "config.json"),
      "utf8"
    )
  );

  assert.match(
    result.stdout,
    new RegExp(`Imported ${importFile.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")} \\(1 tasks, 1 enabled\\)`)
  );
  assert.equal(savedConfig.settings.maxConcurrentRuns, 2);
  assert.equal(savedConfig.settings.outputMode, "json");
  assert.equal(savedConfig.tasks[0].id, "hourly-heartbeat");
  assert.match(savedConfig.tasks[0].runtime.nextRunAt, /^20/);
});
