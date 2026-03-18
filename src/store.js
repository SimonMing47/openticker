import path from "node:path";
import fs from "node:fs/promises";
import { CONFIG_PATH, DEFAULT_CONFIG, LOG_DIR } from "./constants.js";
import { normalizeConfig as normalizeConfigData } from "./config.js";
import { ensureAppDirs, readJson, writeJson } from "./fs.js";
import { normalizeTask } from "./tasks.js";
import { nowIso } from "./utils.js";

export async function loadConfig() {
  await ensureAppDirs();
  const raw = await readJson(CONFIG_PATH);

  if (!raw) {
    const seeded = normalizeConfigData(structuredClone(DEFAULT_CONFIG));
    await saveConfig(seeded);
    return seeded;
  }

  return normalizeConfigData(raw, {
    preserveConfigUpdatedAt: true,
    preserveTaskState: true,
    preserveTaskUpdatedAt: true
  });
}

export async function saveConfig(config) {
  await ensureAppDirs();
  const normalized = normalizeConfigData(config, {
    preserveTaskState: true,
    preserveTaskUpdatedAt: true
  });
  await writeJson(CONFIG_PATH, {
    ...normalized,
    updatedAt: nowIso()
  });
}

export async function updateConfig(mutator) {
  const config = await loadConfig();
  const updated = await mutator(structuredClone(config));
  await saveConfig(updated);
  return updated;
}

export async function addTask(input) {
  const config = await loadConfig();
  const task = normalizeTask(input, config.settings);
  if (config.tasks.some((item) => item.id === task.id)) {
    throw new Error(`Task id already exists: ${task.id}`);
  }
  config.tasks.push(task);
  await saveConfig(config);
  return task;
}

export async function upsertTask(input) {
  const config = await loadConfig();
  const index = config.tasks.findIndex((task) => task.id === input.id);
  const task = normalizeTask(input, config.settings);
  if (index >= 0) {
    config.tasks[index] = task;
  } else {
    config.tasks.push(task);
  }
  await saveConfig(config);
  return task;
}

export async function getTask(taskId) {
  const config = await loadConfig();
  return config.tasks.find((task) => task.id === taskId) || null;
}

export async function removeTask(taskId) {
  const config = await loadConfig();
  const nextTasks = config.tasks.filter((task) => task.id !== taskId);
  if (nextTasks.length === config.tasks.length) {
    return false;
  }
  config.tasks = nextTasks;
  await saveConfig(config);
  return true;
}

export async function updateTask(taskId, updater) {
  const config = await loadConfig();
  const index = config.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    return null;
  }
  const updated = await updater(structuredClone(config.tasks[index]), config);
  config.tasks[index] = updated;
  await saveConfig(config);
  return updated;
}

export async function listLogs(taskId) {
  const taskDir = path.join(LOG_DIR, taskId);
  try {
    const entries = await fs.readdir(taskDir);
    return entries
      .filter((entry) => entry.endsWith(".log"))
      .sort()
      .reverse()
      .map((entry) => path.join(taskDir, entry));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
