/**
 * Tagging on touch, the CLI side (LLD-tagging.md, REQ-IDX-19, -36..41).
 *
 * Detection and the decision live in core (`TouchDetector`, `TouchTagger`).
 * This module gathers what core cannot know — which files the registered
 * adapters write — asks the user once, applies or previews the tags, and
 * reports what happened.
 *
 * @module
 */

import { cancel, isCancel, log, multiselect } from "@clack/prompts";
import { getAdapterByName, getRegisteredTools } from "@dev-session/adapters";
import {
	type FileIndexEntry,
	FileIndexManager,
	GitignoreAwareWalker,
	GitReader,
	inferPurpose,
	MAX_TOUCH_TAGS,
	type PlanChunk,
	SessionBase,
	type SessionState,
	type SkipReason,
	type TouchDecision,
	TouchDetector,
	TouchTagger,
} from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";

/** Options for {@link tagTouchedFiles}. */
export interface TouchTagOptions {
	/** The project root. */
	readonly cwd: string;
	/** Take every file without asking (REQ-IDX-38). */
	readonly yes: boolean;
	/** Report, do not write (REQ-IDX-40, REQ-DRY-7). */
	readonly dryRun: boolean;
	/** Tag nothing (REQ-IDX-39). */
	readonly noTag: boolean;
}

/** What {@link tagTouchedFiles} did. */
export interface TouchTagResult {
	/** FILE_INDEX.md entries after tagging, for the prompt built in the same run. */
	readonly entries: readonly FileIndexEntry[];
	/** How many files gained a tag (or would have, under dry-run). */
	readonly tagged: number;
}

/** What each reason means, for the report. */
const REASON_TEXT: Readonly<Record<SkipReason, string>> = {
	"no-base": "no session base recorded yet; this update records one, and the next one tags",
	"base-missing": "the base commit no longer exists",
	"base-not-ancestor": "HEAD does not descend from the base (branch switch, rebase or amend)",
	"no-user-email": "git user.email is unset, so no commit was counted",
	"unchanged-since-base": "already dirty at the base and unchanged",
	"excluded-path": "deleted, ignored, always-included or written by dev-sesssion",
	"unsafe-path": "path has characters a prompt cannot show bare",
	lockfile: "dependency lockfile",
	"binary-or-generated": "binary, or linguist-generated in .gitattributes",
	"whitespace-only": "only whitespace changed, or the change was reverted",
	"too-many": `more than ${String(MAX_TOUCH_TAGS)} files touched, so none were tagged`,
	"chunk-done": "every task in the active chunk is done",
};

/**
 * Files the tool writes itself outside `.session/` (REQ-IDX-25): each
 * registered adapter's output files, `.gitignore` and `.gitattributes`.
 *
 * @returns The paths.
 */
function toolOwnedFiles(): Set<string> {
	const owned = new Set([".gitignore", ".gitattributes"]);
	for (const name of getRegisteredTools()) {
		for (const f of getAdapterByName(name)?.config.output_files ?? []) owned.add(f);
	}
	return owned;
}

/**
 * Formats one tagged file for the report.
 *
 * @param file - The file.
 * @param chunks - Its new chunks.
 * @returns e.g. `src/a.ts → chunk 1` or `src/a.ts → chunks 1, 5`.
 */
function tagLine(file: string, chunks: readonly number[]): string {
	const list = chunks.map(String).join(", ");
	return `${file} → chunk${chunks.length === 1 ? "" : "s"} ${list}`;
}

/**
 * Prints the decision (REQ-IDX-37, -40).
 *
 * @param d - The decision.
 * @param kept - The files that will be tagged.
 * @param dryRun - Whether nothing is written.
 */
function report(d: TouchDecision, kept: readonly string[], dryRun: boolean): void {
	if (d.stopped !== undefined) {
		log.info(`Tagged nothing from this session — ${d.stopped}: ${REASON_TEXT[d.stopped]}.`);
		return;
	}
	if (kept.length > 0) {
		const verb = dryRun ? "Would tag" : "Tagged";
		const lines = kept.map((f) => `  ${tagLine(f, d.tags.get(f) ?? [])}`);
		log.info(`${verb} from this session's changes:\n${lines.join("\n")}`);
	}
	const skipped = [...d.skipped].map(([r, n]) => `  ${r}: ${String(n)} — ${REASON_TEXT[r]}`);
	if (d.noUserEmail) skipped.unshift(`  no-user-email — ${REASON_TEXT["no-user-email"]}`);
	if (skipped.length > 0) log.info(`Not tagged:\n${skipped.join("\n")}`);
}

/**
 * Asks once which files to tag, every one preselected (REQ-IDX-38).
 *
 * @param d - The decision.
 * @returns The files the user kept; none if cancelled.
 */
async function choose(d: TouchDecision): Promise<string[]> {
	const files = [...d.tags.keys()];
	const result = await multiselect({
		message: "Tag the files this session changed to their chunks (space to toggle):",
		options: files.map((f) => ({ value: f, label: tagLine(f, d.tags.get(f) ?? []) })),
		initialValues: files,
		required: false,
	});
	if (isCancel(result)) {
		cancel("Tagging skipped.");
		return [];
	}
	return result as string[];
}

/**
 * Tags the files this session touched (REQ-IDX-21..40). Does nothing outside
 * git. `advance` never calls it (REQ-IDX-41).
 *
 * @param sessionDir - The `.session/` directory.
 * @param state - Session state, holding the base.
 * @param chunks - Every plan chunk, the active one with live task status.
 * @param entries - FILE_INDEX.md as loaded.
 * @param options - Root, prompting, dry-run and `--no-tag`.
 * @returns The entries to build the prompt from, and how many files gained a tag.
 */
export async function tagTouchedFiles(
	sessionDir: ValidatedPath,
	state: SessionState,
	chunks: readonly PlanChunk[],
	entries: readonly FileIndexEntry[],
	options: TouchTagOptions,
): Promise<TouchTagResult> {
	if (options.noTag || !(await GitReader.isRepo(options.cwd))) return { entries, tagged: 0 };
	const observation = await TouchDetector.detect(options.cwd, state.session_base);
	const walked =
		observation.candidates.length > 0
			? GitignoreAwareWalker.walk(options.cwd).map((f) => f.relativePath)
			: [];
	const decision = TouchTagger.decide({
		observation,
		entries,
		chunks,
		activeChunk: state.active_chunk,
		completed: Object.keys(state.completed_chunks).map(Number),
		toolOwned: toolOwnedFiles(),
		walked,
	});
	const kept =
		options.yes || decision.tags.size === 0 ? [...decision.tags.keys()] : await choose(decision);
	report(decision, kept, options.dryRun);

	let next: FileIndexEntry[] = [...entries];
	for (const f of kept)
		next = FileIndexManager.tag(next, f, decision.tags.get(f) ?? [], inferPurpose(f));
	if (!options.dryRun && kept.length > 0) FileIndexManager.save(sessionDir, next);
	return { entries: next, tagged: kept.length };
}

/**
 * Returns the state with a fresh session base, or with none outside git or
 * past 200 dirty files (REQ-IDX-19, -20). Called by `init`, `update` and
 * `advance` just before they save state.
 *
 * @param state - The state about to be saved.
 * @param cwd - The project root.
 * @returns The state with `session_base` replaced.
 */
export async function withSessionBase(state: SessionState, cwd: string): Promise<SessionState> {
	const { session_base: _old, ...rest } = state;
	const base = await SessionBase.capture(cwd);
	return base === null ? rest : { ...rest, session_base: base };
}
