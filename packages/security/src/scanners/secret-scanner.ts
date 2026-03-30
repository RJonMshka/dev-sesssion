/**
 * Synchronous secret detection scanner.
 *
 * Scans content for 10 known secret patterns (API keys, tokens, private keys).
 * Returns scan results with redacted matches — never exposes full secret values.
 *
 * @packageDocumentation
 */

/**
 * A single detected secret in scanned content.
 */
export interface ScanResult {
	/** The name of the pattern that matched (e.g., "AWS Access Key"). */
	readonly pattern: string;
	/** The 1-indexed line number where the match was found. */
	readonly line: number;
	/** A redacted version of the matched value. Shows first 4 chars + asterisks. */
	readonly redacted: string;
}

/**
 * A named regex pattern used for secret detection.
 */
interface SecretPattern {
	/** Human-readable pattern name. */
	readonly name: string;
	/** The regex to test against each line of content. */
	readonly regex: RegExp;
}

/**
 * The 10 secret patterns scanned by {@link SecretScanner}.
 *
 * Each pattern is designed to minimize false positives while catching
 * real secrets that commonly leak into configuration and markdown files.
 */
const SECRET_PATTERNS: readonly SecretPattern[] = [
	{
		name: "AWS Access Key",
		regex: /\bAKIA[0-9A-Z]{16}\b/,
	},
	{
		name: "AWS Secret Key",
		regex:
			/(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/,
	},
	{
		name: "GitHub PAT (classic)",
		regex: /\bghp_[A-Za-z0-9]{36}\b/,
	},
	{
		name: "GitHub PAT (fine-grained)",
		regex: /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/,
	},
	{
		name: "npm Token",
		regex: /\bnpm_[A-Za-z0-9]{36}\b/,
	},
	{
		name: "OpenAI API Key",
		regex: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/,
	},
	{
		name: "Anthropic API Key",
		regex: /\bsk-ant-[A-Za-z0-9\-_]{80,}\b/,
	},
	{
		name: "Private Key Header",
		regex: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/,
	},
	{
		name: "Generic Secret Assignment",
		regex:
			/(?:secret|token|password|api_key|apikey|api-key|access_token)\s*[=:]\s*["'][A-Za-z0-9/+=\-_]{16,}["']/i,
	},
	{
		name: "Generic Bearer Token",
		regex: /\bBearer\s+[A-Za-z0-9\-_.~+/]+=*\b/,
	},
] as const;

/**
 * Number of leading characters to show in redacted output.
 * The rest is replaced with asterisks.
 */
const REDACT_VISIBLE_CHARS = 4;

/** Minimum redacted output length. */
const REDACT_MIN_LENGTH = 10;

/**
 * Redacts a matched secret value by showing only the first few characters.
 *
 * @param match - The full matched string.
 * @returns A redacted version showing at most {@link REDACT_VISIBLE_CHARS} characters.
 */
function redactMatch(match: string): string {
	if (match.length <= REDACT_VISIBLE_CHARS) {
		return "*".repeat(REDACT_MIN_LENGTH);
	}
	const visible = match.slice(0, REDACT_VISIBLE_CHARS);
	const asteriskCount = Math.max(
		REDACT_MIN_LENGTH - REDACT_VISIBLE_CHARS,
		match.length - REDACT_VISIBLE_CHARS,
	);
	return visible + "*".repeat(asteriskCount);
}

/**
 * Extracts the best match string from a regex result.
 * Prefers capture group 1 (the actual secret value) if present,
 * otherwise uses the full match.
 *
 * @param result - The regex exec result.
 * @returns The matched string to redact.
 */
function extractMatch(result: RegExpExecArray): string {
	// Some patterns (like AWS Secret Key) use a capture group for the actual value
	return result[1] ?? result[0];
}

/**
 * Synchronous secret scanner for content strings.
 *
 * Scans text line-by-line against 10 known secret patterns.
 * Returns results with redacted matches — the full secret value is never stored or returned.
 */
export const SecretScanner = {
	/**
	 * Scans content for known secret patterns.
	 *
	 * @param content - The text content to scan (typically file contents).
	 * @returns An array of {@link ScanResult} for each detected secret. Empty array if none found.
	 *
	 * @example
	 * ```ts
	 * const results = SecretScanner.scan("AKIAIOSFODNN7EXAMPLE");
	 * // [{ pattern: "AWS Access Key", line: 1, redacted: "AKIA****************" }]
	 * ```
	 */
	scan(content: string): ScanResult[] {
		const results: ScanResult[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line === undefined) {
				continue;
			}
			scanLine(line, i + 1, results);
		}

		return results;
	},

	/**
	 * Returns the number of secret patterns checked by the scanner.
	 *
	 * @returns The count of registered secret patterns.
	 */
	get patternCount(): number {
		return SECRET_PATTERNS.length;
	},
} as const;

/**
 * Scans a single line against all secret patterns and appends matches to results.
 *
 * @param line - The line of text to scan.
 * @param lineNumber - The 1-indexed line number (for reporting).
 * @param results - The results array to append matches to.
 */
function scanLine(line: string, lineNumber: number, results: ScanResult[]): void {
	for (const pattern of SECRET_PATTERNS) {
		const result = pattern.regex.exec(line);
		if (result !== null) {
			const matchValue = extractMatch(result);
			results.push({
				pattern: pattern.name,
				line: lineNumber,
				redacted: redactMatch(matchValue),
			});
		}
	}
}
