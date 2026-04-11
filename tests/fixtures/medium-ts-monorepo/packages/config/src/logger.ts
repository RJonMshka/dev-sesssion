import { env } from "./env.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
	const configured = (env.LOG_LEVEL as LogLevel) ?? "info";
	return LEVELS[level] >= (LEVELS[configured] ?? 1);
}

function format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
	const ts = new Date().toISOString();
	const base = `[${ts}] ${level.toUpperCase()} ${message}`;
	return meta ? `${base} ${JSON.stringify(meta)}` : base;
}

export const logger = {
	debug: (msg: string, meta?: Record<string, unknown>) => {
		if (shouldLog("debug")) console.debug(format("debug", msg, meta));
	},
	info: (msg: string, meta?: Record<string, unknown>) => {
		if (shouldLog("info")) console.info(format("info", msg, meta));
	},
	warn: (msg: string, meta?: Record<string, unknown>) => {
		if (shouldLog("warn")) console.warn(format("warn", msg, meta));
	},
	error: (msg: string, meta?: Record<string, unknown>) => {
		if (shouldLog("error")) console.error(format("error", msg, meta));
	},
};
