/**
 * Atomic file writer that prevents partial writes and corruption.
 *
 * Wraps `write-file-atomic` to ensure every file write is atomic:
 * content is written to a temporary file first, then renamed to the target path.
 * If the process crashes mid-write, the original file remains intact.
 *
 * All writes go through {@link WriteGuard} for secret scanning before writing.
 *
 * @packageDocumentation
 */

import writeFileAtomicCallback from "write-file-atomic";
import type { WriteGuardOptions } from "../guards/write-guard.js";
import { WriteGuard } from "../guards/write-guard.js";
import type { ValidatedPath } from "../validators/path-validator.js";

// write-file-atomic v7 exports .sync on the default export
const writeFileAtomicSync = writeFileAtomicCallback.sync;

/** Default file mode for written files: owner rw, group r, others r. */
const DEFAULT_FILE_MODE = 0o644;

/**
 * Options for {@link AtomicWriter.writeFile}.
 */
export interface AtomicWriteOptions {
	/**
	 * File mode to set on the written file.
	 * @defaultValue `0o644`
	 */
	readonly mode?: number | undefined;

	/**
	 * File encoding for the write.
	 * @defaultValue `"utf8"`
	 */
	readonly encoding?: BufferEncoding | undefined;

	/**
	 * Secret scanning options passed to {@link WriteGuard}.
	 * Set `strict: true` to block writes containing secrets.
	 */
	readonly guard?: WriteGuardOptions | undefined;

	/**
	 * Skip the WriteGuard secret scan entirely.
	 * This should only be used for internal writes that are known-safe.
	 * @defaultValue `false`
	 */
	readonly skipGuard?: boolean | undefined;
}

/**
 * Result of an atomic write operation.
 */
export interface AtomicWriteResult {
	/** The validated path that was written to. */
	readonly path: ValidatedPath;
	/** Number of bytes written. */
	readonly bytesWritten: number;
	/** Any secret scan warnings from the WriteGuard. */
	readonly warnings: readonly import("../scanners/secret-scanner.js").ScanResult[];
}

/**
 * Atomic file writer with integrated secret scanning.
 *
 * Every file write in dev-sesssion must go through this writer.
 * It enforces:
 * 1. Secret scanning via {@link WriteGuard} (unless explicitly skipped)
 * 2. Atomic writes via `write-file-atomic` (write to .tmp, then rename)
 * 3. Consistent file permissions (`0o644` by default)
 */
export const AtomicWriter = {
	/**
	 * Atomically writes content to a validated file path.
	 *
	 * The write is performed synchronously: content goes to a temporary file first,
	 * then is renamed to the target. If anything fails, the original file is untouched.
	 *
	 * @param filePath - A {@link ValidatedPath} that has been security-checked.
	 * @param content - The string content to write.
	 * @param options - Optional write configuration.
	 * @returns An {@link AtomicWriteResult} with the path, bytes written, and any warnings.
	 * @throws {SecurityError} If strict mode is enabled and secrets are detected.
	 * @throws {Error} If the underlying write operation fails.
	 *
	 * @example
	 * ```ts
	 * const validated = PathValidator.safeResolvePath("config.yml", projectRoot);
	 * const result = AtomicWriter.writeFile(validated, yamlContent);
	 * ```
	 */
	writeFile(
		filePath: ValidatedPath,
		content: string,
		options?: AtomicWriteOptions,
	): AtomicWriteResult {
		const warnings = guardContent(content, options);
		const bytesWritten = Buffer.byteLength(content, options?.encoding ?? "utf8");

		try {
			writeFileAtomicSync(filePath, content, {
				mode: options?.mode ?? DEFAULT_FILE_MODE,
				encoding: options?.encoding ?? "utf8",
			});
		} catch (error: unknown) {
			// Re-throw with context but don't expose the full path
			throw new Error(`Atomic write failed for file`, { cause: error });
		}

		return {
			path: filePath,
			bytesWritten,
			warnings,
		};
	},

	/**
	 * Atomically writes content to a validated file path (async version).
	 *
	 * @param filePath - A {@link ValidatedPath} that has been security-checked.
	 * @param content - The string content to write.
	 * @param options - Optional write configuration.
	 * @returns A promise resolving to an {@link AtomicWriteResult}.
	 * @throws {SecurityError} If strict mode is enabled and secrets are detected.
	 * @throws {Error} If the underlying write operation fails.
	 */
	async writeFileAsync(
		filePath: ValidatedPath,
		content: string,
		options?: AtomicWriteOptions,
	): Promise<AtomicWriteResult> {
		const warnings = guardContent(content, options);
		const bytesWritten = Buffer.byteLength(content, options?.encoding ?? "utf8");

		try {
			await writeFileAtomicCallback(filePath, content, {
				mode: options?.mode ?? DEFAULT_FILE_MODE,
				encoding: options?.encoding ?? "utf8",
			});
		} catch (error: unknown) {
			throw new Error(`Atomic write failed for file`, { cause: error });
		}

		return {
			path: filePath,
			bytesWritten,
			warnings,
		};
	},
} as const;

/**
 * Runs the WriteGuard check on content, returning any warnings.
 *
 * @param content - The content to scan.
 * @param options - Write options containing guard configuration.
 * @returns Array of scan result warnings (empty if no secrets or guard skipped).
 * @throws {SecurityError} If guard is in strict mode and secrets are detected.
 */
function guardContent(
	content: string,
	options?: AtomicWriteOptions,
): readonly import("../scanners/secret-scanner.js").ScanResult[] {
	if (options?.skipGuard === true) {
		return [];
	}

	const guardResult = WriteGuard.check(content, options?.guard);
	return guardResult.results;
}
