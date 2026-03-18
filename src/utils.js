import path from "node:path";
import crypto from "node:crypto";
import dayjs from "dayjs";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix = "task") {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function resolveWorkdir(workdir) {
  if (!workdir) {
    return process.cwd();
  }
  return path.resolve(workdir);
}

export function formatDateTime(input) {
  if (!input) {
    return "never";
  }
  return dayjs(input).format("YYYY-MM-DD HH:mm:ss");
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "n/a";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3_600_000) {
    return `${(ms / 60_000).toFixed(1)}m`;
  }
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function pad(input, size) {
  const text = String(input);
  if (text.length >= size) {
    return text;
  }
  return `${text}${" ".repeat(size - text.length)}`;
}

export function splitArgs(raw) {
  if (!raw) {
    return [];
  }

  const args = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const previous = raw[index - 1];

    if ((char === "'" || char === '"') && previous !== "\\") {
      if (quote === char) {
        quote = null;
        continue;
      }
      if (!quote) {
        quote = char;
        continue;
      }
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}
