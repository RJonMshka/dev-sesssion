/**
 * Options for constructing a {@link CliError}.
 */
export interface CliErrorOptions {
	/** A user-facing description of what went wrong. Must not contain absolute paths. */
	readonly message: string;
	/** An optional actionable suggestion for the user to resolve the issue. */
	readonly suggestion?: string | undefined;
	/** The original error that caused this CLI error, if any. */
	readonly cause?: unknown;
}

/**
 * Error thrown for user-facing CLI failures.
 *
 * Includes an optional `suggestion` field with actionable advice.
 * Error messages must never contain absolute paths — use `path.relative()` before constructing.
 *
 * @throws Never — this class is thrown, not caught internally.
 *
 * @example
 * ```ts
 * throw new CliError({
 *   message: "No .session/ directory found in the current project",
 *   suggestion: "Run `npx dev-sesssion init` to create one",
 * });
 * ```
 */
export class CliError extends Error {
	/** Discriminant for runtime type checking. */
	override readonly name = "CliError" as const;

	/** An actionable suggestion for the user to resolve the issue, if available. */
	readonly suggestion: string | undefined;

	/**
	 * Creates a new CliError.
	 *
	 * @param options - The message, optional suggestion, and optional cause.
	 */
	constructor(options: CliErrorOptions) {
		super(options.message, { cause: options.cause });
		this.suggestion = options.suggestion;
	}
}

/**
 * Type guard to check if an unknown value is a {@link CliError}.
 *
 * @param error - The value to check.
 * @returns `true` if the value is a CliError instance.
 */
export function isCliError(error: unknown): error is CliError {
	return error instanceof CliError;
}
