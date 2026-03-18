import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, DATA_DIR, LOG_DIR, RUNTIME_DIR } from "./constants.js";

export async function ensureAppDirs() {
  await Promise.all(
    [CONFIG_DIR, DATA_DIR, LOG_DIR, RUNTIME_DIR].map((dir) =>
      fs.mkdir(dir, { recursive: true })
    )
  );
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (isMissing(error)) {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isMissing(error) {
  return Boolean(error && typeof error === "object" && error.code === "ENOENT");
}
