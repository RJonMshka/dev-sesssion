function optional(name: string, fallback: string): string {
	return process.env[name] ?? fallback;
}

export const env = {
	NODE_ENV: optional("NODE_ENV", "development"),
	PORT: Number(optional("PORT", "3000")),
	DATABASE_URL: optional("DATABASE_URL", ""),
	JWT_SECRET: optional("JWT_SECRET", "dev-secret-change-in-production"),
	JWT_EXPIRY: optional("JWT_EXPIRY", "1h"),
	LOG_LEVEL: optional("LOG_LEVEL", "info"),
	RATE_LIMIT_WINDOW_MS: Number(optional("RATE_LIMIT_WINDOW_MS", "60000")),
	RATE_LIMIT_MAX: Number(optional("RATE_LIMIT_MAX", "100")),
} as const;

export type Env = typeof env;
