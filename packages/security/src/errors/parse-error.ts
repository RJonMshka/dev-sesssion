/**
 * Options for constructing a {@link ParseError}.
 */
export interface ParseErrorOptions {
	/** A human-readable description of the parse failure. Must not contain raw YAML or absolute paths. */
	readonly message: string;
	/** The relative file path where the parse failure occurred. */
	readonly file: string;
	/** The line number where the parse failure occurred, if known. */
	readonly line?: number | undefined;
	/** The original error that caused this parse error, if any. */
	readonly cause?: unknown;
}

/**
 * Error thrown when file content cannot be parsed.
 *
 * Includes `file` (always a relative path) and optional `line` number.
 * The `message` field must never contain raw YAML content — sanitize before constructing.
 *
 * @throws Never — this class is thrown, not caught internally.
 *
 * @example
 * ```ts
 * throw new ParseError({
 *   message: "Invalid frontmatter: expected 'title' to be a string",
 *   file: ".session/SESSION_STATE.md",
 *   line: 3,
 * });
 * ```
 */
export class ParseError extends Error {
	/** Discriminant for runtime type checking. */
	override readonly name = "ParseError" as const;

	/** The relative file path where parsing failed. */
	readonly file: string;

	/** The line number where parsing failed, if known. */
	readonly line: number | undefined;

	/**
	 * Creates a new ParseError.
	 *
	 * @param options - The message, file path, optional line number, and optional cause.
	 */
	constructor(options: ParseErrorOptions) {
		super(options.message, { cause: options.cause });
		this.file = options.file;
		this.line = options.line;
	}
}

/**
 * Type guard to check if an unknown value is a {@link ParseError}.
 *
 * @param error - The value to check.
 * @returns `true` if the value is a ParseError instance.
 */
export function isParseError(error: unknown): error is ParseError {
	return error instanceof ParseError;
}
