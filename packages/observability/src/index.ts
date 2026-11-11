export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

/** Minimal structured logger scaffold — swap for pino/winston later. */
export function createLogger(service: string) {
  function write(level: LogLevel, message: string, fields?: LogFields): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      service,
      message,
      ...fields,
    };
    console[level === "debug" ? "log" : level](JSON.stringify(entry));
  }

  return {
    debug: (message: string, fields?: LogFields) => write("debug", message, fields),
    info: (message: string, fields?: LogFields) => write("info", message, fields),
    warn: (message: string, fields?: LogFields) => write("warn", message, fields),
    error: (message: string, fields?: LogFields) => write("error", message, fields),
  };
}
