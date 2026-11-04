/**
 * Brings `ai-index.yaml` up to date before `update` and `advance` build a
 * prompt from it (LLD-symbols.md, REQ-SYM-20, -21, -25, -26).
 *
 * @module
 */

import { log } from "@clack/prompts";
import { type AiIndex, AiIndexBuilder, AiIndexManager } from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { PathValidator } from "@dev-session/security";
import { secretWarnings } from "./secret-warning.js";

/** Flags the refresh honours. */
export interface RefreshIndexOptions {
	/** Project root. */
	readonly cwd: string;
	/** Log instead of writing (REQ-SYM-25). */
	readonly dryRun: boolean;
	/** Block the save on a detected secret. */
	readonly strict: boolean;
}

/**
 * Refreshes the index on disk, and saves it only when an entry changed.
 *
 * Never fails the command: on any error it warns and returns the index on
 * disk, so the prompt is still built (REQ-SYM-26).
 *
 * @param sessionDir - Validated path to `.session/`.
 * @param options - Root and flags.
 * @returns The index to build the prompt from, or `null` when there is none.
 */
export async function refreshIndexForPrompt(
	sessionDir: ValidatedPath,
	options: RefreshIndexOptions,
): Promise<AiIndex | null> {
	let onDisk: AiIndex | null = null;
	try {
		onDisk = AiIndexManager.load(sessionDir);
		// No index, no refresh: an index is created by init or `index` (REQ-SYM-20).
		if (onDisk === null) return null;

		const secrets = secretWarnings();
		const root = PathValidator.safeResolvePath(".", options.cwd);
		const r = await AiIndexBuilder.refresh(root, onDisk, { onSecret: secrets.onSecret });
		secrets.report();
		const changed = r.reread.length + r.added.length + r.dropped.length;
		if (changed === 0) return onDisk; // REQ-SYM-21

		const what = `${String(r.reread.length)} changed, ${String(r.added.length)} new, ${String(r.dropped.length)} gone`;
		if (options.dryRun) {
			log.info(`[dry-run] Would update ai-index.yaml (${what}).`);
		} else {
			AiIndexManager.save(sessionDir, r.index, options.strict);
			log.info(`Refreshed ai-index.yaml (${what}).`);
		}
		return r.index;
	} catch {
		log.warn(
			"Could not refresh ai-index.yaml; the prompt uses the index on disk. Run `dev-sesssion index` to rebuild it.",
		);
		return onDisk;
	}
}
