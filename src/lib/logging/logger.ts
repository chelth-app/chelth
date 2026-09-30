/**
 * Application logger.
 *
 * - Structured: one JSON object per line on the server (Vercel log drains and
 *   future Sentry/OTel integrations can parse it).
 * - Redacted: every context object passes through `redact()`.
 * - Pluggable: additional sinks (e.g. Sentry) register via `addLogSink`, so
 *   no call site depends on a vendor SDK.
 *
 * Never log: access/refresh tokens, passwords, credential documents, form
 * payloads, or healthcare workforce identifiers. Log IDs and codes instead.
 */
import type { LogLevel } from "@/config/env.schema";

import { redact, redactString } from "./redact";

export type LogContext = Record<string, unknown>;

export type LogRecord = {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: unknown;
};

export type LogSink = (record: LogRecord) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else console.log(line);
};

let minimumLevel: LogLevel = "info";
let sinks: LogSink[] = [consoleSink];

export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

export function addLogSink(sink: LogSink): () => void {
  sinks.push(sink);
  return () => {
    sinks = sinks.filter((existing) => existing !== sink);
  };
}

/** Test hook: replace all sinks. */
export function setLogSinks(next: LogSink[]): void {
  sinks = next;
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) return;
  const record: LogRecord = {
    level,
    message: redactString(message),
    timestamp: new Date().toISOString(),
    ...(context !== undefined ? { context: redact(context) } : {}),
  };
  for (const sink of sinks) {
    try {
      sink(record);
    } catch {
      // A failing sink must never break the request that is logging.
    }
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
