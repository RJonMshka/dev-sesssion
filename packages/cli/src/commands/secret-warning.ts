/**
 * The warning `init` and `index` print when extraction redacted a secret
 * (LLD-context-provenance.md, REQ-PROV-15). Presentation only: the redaction
 * itself happens in core's extractor (REQ-PROV-14).
 *
 * @module
 */

import { log } from "@clack/prompts";

/** Collects redactions during a build, then reports them once. */
export interface SecretWarnings {
	/** Pass to `AiIndexBuilder.fromDirectory` as `onSecret`. */
	readonly onSecret: (relPath: string, patterns: readonly string[]) => void;
	/** Prints one warning per file, if any secret was redacted. */
	report(): void;
}

/**
 * Starts collecting redactions.
 *
 * @returns A collector whose `report` names each file and pattern, never the value.
 */
export function secretWarnings(): SecretWarnings {
	const found = new Map<string, readonly string[]>();
	return {
		onSecret: (relPath, patterns) => {
			found.set(relPath, patterns);
		},
		report: () => {
			for (const [relPath, patterns] of found) warnSecret(relPath, patterns);
		},
	};
}

/**
 * Warns that a file's doc comments held a secret the index now masks.
 *
 * @param relPath - Project-relative path of the file.
 * @param patterns - Names of the patterns redacted.
 */
export function warnSecret(relPath: string, patterns: readonly string[]): void {
	log.warn(
		`Redacted a secret (${patterns.join(", ")}) from the doc comments of ${relPath}. ` +
			"The index holds a masked copy; remove it from the source and rotate it.",
	);
}
