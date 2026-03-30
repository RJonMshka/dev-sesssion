/**
 * Write guard middleware that scans content for secrets before writing.
 *
 * Pipeline: scan content with {@link SecretScanner} -> warn or block -> delegate to writer.
 * Supports warn mode (default), strict/block mode, and inline bypass comments.
 *
 * @packageDocumentation
 */

import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";
import type { ScanResult } from "../scanners/secret-scanner.js";
import { SecretScanner } from "../scanners/secret-scanner.js";

/**
 * Inline comment that bypasses secret scanning for a file.
 * When this string appears anywhere in the content, the WriteGuard
 * allows the write without scanning.
 */
const BYPASS_COMMENT = "<!-- dev-session:allow -->";

/**
 * Options for {@link WriteGuard.check}.
 */
export interface WriteGuardOptions {
	/**
	 * When `true`, throws a {@link SecurityError} if secrets are detected.
	 * When `false` (default), returns the scan results as warnings without blocking.
	 */
	readonly strict?: boolean | undefined;
}

/**
 * Result of a write guard check.
 */
export interface WriteGuardResult {
	/** Whether the write is allowed to proceed. Always `true` unless strict mode blocks it. */
	readonly allowed: boolean;
	/** Whether the content contains the bypass comment. */
	readonly bypassed: boolean;
	/** Any secrets detected during scanning. Empty if bypassed or no secrets found. */
	readonly results: readonly ScanResult[];
}

/**
 * Middleware that scans content for secrets before file writes.
 *
 * The WriteGuard sits between the caller and {@link AtomicWriter},
 * enforcing secret detection policies:
 *
 * - **Warn mode** (default): Returns scan results but allows the write.
 * - **Strict mode**: Throws {@link SecurityError} if secrets are detected.
 * - **Bypass**: Content containing `<!-- dev-session:allow -->` skips scanning entirely.
 */
export const WriteGuard = {
	/**
	 * Checks content for secrets and returns a guard result.
	 *
	 * @param content - The content to scan before writing.
	 * @param options - Optional configuration. Set `strict: true` to block on detection.
	 * @returns A {@link WriteGuardResult} indicating whether the write is allowed.
	 * @throws {SecurityError} With `SECRET_DETECTED` threat if strict mode is enabled and secrets are found.
	 *
	 * @example
	 * ```ts
	 * const result = WriteGuard.check(fileContent);
	 * if (result.results.length > 0) {
	 *   console.warn("Secrets detected:", result.results);
	 * }
	 * ```
	 *
	 * @example
	 * ```ts
	 * // Strict mode — throws on detection
	 * WriteGuard.check(fileContent, { strict: true });
	 * ```
	 */
	check(content: string, options?: WriteGuardOptions): WriteGuardResult {
		// Check for bypass comment first
		if (content.includes(BYPASS_COMMENT)) {
			return {
				allowed: true,
				bypassed: true,
				results: [],
			};
		}

		const results = SecretScanner.scan(content);

		// No secrets found — always allowed
		if (results.length === 0) {
			return {
				allowed: true,
				bypassed: false,
				results: [],
			};
		}

		// Secrets found in strict mode — block the write
		if (options?.strict === true) {
			const summary = formatScanSummary(results);
			throw new SecurityError({
				threat: SecurityThreat.SECRET_DETECTED,
				message: `Write blocked: ${summary}`,
			});
		}

		// Secrets found in warn mode — allow but report
		return {
			allowed: true,
			bypassed: false,
			results,
		};
	},

	/**
	 * The bypass comment string that disables scanning for a file.
	 *
	 * @returns The bypass comment string.
	 */
	get bypassComment(): string {
		return BYPASS_COMMENT;
	},
} as const;

/**
 * Formats a summary of scan results for error messages.
 *
 * @param results - The scan results to summarize.
 * @returns A human-readable summary string.
 */
function formatScanSummary(results: readonly ScanResult[]): string {
	const count = results.length;
	const patterns = [...new Set(results.map((r) => r.pattern))];
	const patternList = patterns.join(", ");
	return `${String(count)} secret${count === 1 ? "" : "s"} detected (${patternList})`;
}
