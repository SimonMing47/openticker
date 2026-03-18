import dayjs from "dayjs";
import parseDuration from "parse-duration";
import { CronExpressionParser } from "cron-parser";

export function parseCronNext(cron, timezone, currentDate = new Date()) {
  const interval = CronExpressionParser.parse(cron, {
    currentDate,
    tz: timezone
  });
  return interval.next().toDate();
}

export function parseDelayInput(raw) {
  if (!raw) {
    throw new Error("Delay input is required");
  }

  const durationMs = parseDuration(raw, "ms");
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error(`Invalid delay: ${raw}`);
  }

  return Number(durationMs);
}

export function parseDateInput(raw) {
  if (!raw) {
    throw new Error("Date input is required");
  }

  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${raw}`);
  }

  return date;
}

export function fromDelay(raw, baseDate = new Date()) {
  const delayMs = parseDelayInput(raw);
  return {
    delayMs,
    runAt: new Date(baseDate.getTime() + delayMs)
  };
}

export function humanizeSchedule(task) {
  if (task.type === "cron") {
    return task.schedule.cron;
  }
  if (task.type === "once") {
    return `at ${formatHumanDate(task.schedule.at)}`;
  }
  return `after ${task.schedule.delayText || formatDelay(task.schedule.delayMs)}`;
}

export function formatHumanDate(input) {
  if (!input) {
    return "n/a";
  }
  return dayjs(input).format("YYYY-MM-DD HH:mm:ss");
}

export function formatDelay(delayMs) {
  if (!Number.isFinite(delayMs)) {
    return "n/a";
  }

  const seconds = Math.round(delayMs / 1000);
  const parts = [];
  const units = [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1]
  ];

  let remainder = seconds;
  for (const [label, amount] of units) {
    if (remainder >= amount) {
      const value = Math.floor(remainder / amount);
      remainder -= value * amount;
      parts.push(`${value}${label}`);
    }
  }

  return parts.join(" ") || "0s";
}

export function relativeToNow(target) {
  if (!target) {
    return "n/a";
  }
  const diff = new Date(target).getTime() - Date.now();
  const absolute = formatDelay(Math.abs(diff));
  return diff >= 0 ? `in ${absolute}` : `${absolute} ago`;
}
