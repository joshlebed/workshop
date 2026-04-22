import { getConfig } from "./config.js";

type Level = "debug" | "info" | "warn" | "error";

const levelOrder: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: Level): boolean {
  const cfg = getConfig();
  return levelOrder[level] >= levelOrder[cfg.logLevel];
}

function serialize(level: Level, msg: string, fields?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...fields,
  };
  if (fields?.error instanceof Error) {
    const err = fields.error;
    entry.error = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return JSON.stringify(entry);
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  const line = serialize(level, msg, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
