import type { SecurityThreat } from "./security-threat.js";

/**
 * Options for constructing a {@link SecurityError}.
 */
export interface SecurityErrorOptions {
	/** The category of security threat that was detected. */
	readonly threat: SecurityThreat;
	/** A human-readable description of the threat. Must not contain absolute paths. */
	readonly message: string;
	/** The original error that caused this security error, if any. */
	readonly cause?: unknown;
}

/**
 * Error thrown when a security violation is detected.
 *
 * Includes a `threat` field classifying the type of violation.
 * Error messages must never contain absolute paths — use `path.relative()` before constructing.
 *
 * @throws Never — this class is thrown, not caught internally.
 *
 * @example
 * ```ts
 * throw new SecurityError({
 *   threat: SecurityThreat.PATH_TRAVERSAL,
 *   message: `Path "${relativePath}" resolves outside project root`,
 * });
 * ```
 */
export class SecurityError extends Error {
	/** Discriminant for runtime type checking. */
	override readonly name = "SecurityError" as const;

	/** The category of security threat that triggered this error. */
	readonly threat: SecurityThreat;

	/**
	 * Creates a new SecurityError.
	 *
	 * @param options - The threat type, message, and optional cause.
	 */
	constructor(options: SecurityErrorOptions) {
		super(options.message, { cause: options.cause });
		this.threat = options.threat;
	}
}

/**
 * Type guard to check if an unknown value is a {@link SecurityError}.
 *
 * @param error - The value to check.
 * @returns `true` if the value is a SecurityError instance.
 */
export function isSecurityError(error: unknown): error is SecurityError {
	return error instanceof SecurityError;
}
