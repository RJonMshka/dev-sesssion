/**
 * Tagging on touch — tag a file to the active chunk when a session edits it
 * (LLD-tagging.md, REQ-IDX-19..33).
 *
 * Three steps, split I/O from decision as `NewFiles` is:
 *
 * - {@link SessionBase.capture} records where a session starts: `HEAD` and the
 *   hash of every file already dirty.
 * - {@link TouchDetector.detect} asks git what changed since then, by whom,
 *   and whether the change is more than whitespace.
 * - {@link TouchTagger.decide} is pure: which of those files get which chunks,
 *   and why the rest do not.
 *
 * The ruling constraint is "wrong is worse than absent": the load list is
 * capped, so a wrong tag pushes out a right one. Wherever a rule has to choose,
 * it chooses not to tag.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import { PathValidator, type ValidatedPath } from "@dev-session/security";
import { contentHash } from "../annotation/unit-extractor.js";
import { PATH_SHAPED } from "../formatters/formatter-utils.js";
import { type DiffKind, GitReader } from "../git/git-reader.js";
import {
	type FileIndexEntry,
	MAX_SESSION_BASE_DIRTY,
	type PlanChunk,
	type SessionBaseRecord,
} from "../schemas/index.js";
import { isAlwaysIgnored, LOCKFILE_NAMES } from "../walkers/gitignore-aware-walker.js";
import { referencedFiles } from "./file-reference.js";

/** Most files one `update` tags; more is a sweep, and tags none (REQ-IDX-30). */
export const MAX_TOUCH_TAGS = 20;

/** Why a touched file was not tagged, or why nothing was looked at. */
export type SkipReason =
	| "no-base"
	| "base-missing"
	| "base-not-ancestor"
	| "no-user-email"
	| "unchanged-since-base"
	| "excluded-path"
	| "unsafe-path"
	| "lockfile"
	| "binary-or-generated"
	| "whitespace-only"
	| "too-many"
	| "chunk-done";

/** The reasons that stop detection before any file is looked at (REQ-IDX-24). */
export type StopReason = Extract<SkipReason, "no-base" | "base-missing" | "base-not-ancestor">;

/** One touched file, with git's facts about it. */
export interface TouchCandidate {
	/** Repo-relative path, as git reports it. */
	readonly path: string;
	/** Whether the file exists now. */
	readonly exists: boolean;
	/** Whether its change since the base is substantive, whitespace, or binary. */
	readonly change: DiffKind;
	/** Whether `.gitattributes` marks it `linguist-generated`. */
	readonly generated: boolean;
}

/** What {@link TouchDetector.detect} saw. */
export interface TouchObservation {
	/** Set when detection stopped before looking at files (REQ-IDX-24). */
	readonly stopped?: StopReason;
	/** `user.email` is unset, so no commit was counted (REQ-IDX-21). */
	readonly noUserEmail: boolean;
	/** Files dirty at the base and unchanged since (REQ-IDX-23). */
	readonly unchangedSinceBase: number;
	/** The touched files, in path order. */
	readonly candidates: readonly TouchCandidate[];
}

/** Inputs for {@link TouchTagger.decide}. */
export interface TouchDecisionInput {
	/** What the detector saw. */
	readonly observation: TouchObservation;
	/** FILE_INDEX.md as it stands; always-include entries are never tagged. */
	readonly entries: readonly FileIndexEntry[];
	/** The plan's chunks, the active one with its live task status. */
	readonly chunks: readonly PlanChunk[];
	/** The chunk the session worked on. */
	readonly activeChunk: number;
	/** Completed chunk ids; they never gain a tag (REQ-IDX-33). */
	readonly completed: readonly number[];
	/** Files the tool writes itself outside `.session/` (REQ-IDX-25). */
	readonly toolOwned: ReadonlySet<string>;
	/** Every walked path, for the matcher's uniqueness rule (REQ-RUN-3). */
	readonly walked: readonly string[];
}

/** What {@link TouchTagger.decide} decided. */
export interface TouchDecision {
	/** File → chunks to add, active chunk first. */
	readonly tags: ReadonlyMap<string, readonly number[]>;
	/** Files left untagged, counted under the first reason that applied. */
	readonly skipped: ReadonlyMap<SkipReason, number>;
	/** Set when nothing was looked at, and why. */
	readonly stopped?: StopReason;
	/** `user.email` is unset, so no commit was counted. */
	readonly noUserEmail: boolean;
}

/**
 * Hashes a file the way the base does, or `null` if it cannot be read.
 *
 * @param root - The project root.
 * @param rel - A repo-relative path from git.
 * @returns The content hash, or `null`.
 */
function hashOf(root: string, rel: string): string | null {
	try {
		const abs = PathValidator.safeResolvePath(rel, root);
		return contentHash(fs.readFileSync(abs, "utf-8"));
	} catch {
		return null;
	}
}

/**
 * Validates a git path against the root, or `null` if it escapes or is absent.
 *
 * @param root - The project root.
 * @param rel - A repo-relative path from git.
 * @returns The absolute path, or `null`.
 */
function existing(root: string, rel: string): ValidatedPath | null {
	try {
		const abs = PathValidator.safeResolvePath(rel, root);
		return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
	} catch {
		return null;
	}
}

/**
 * Whether a string holds a C0 control character or DEL.
 *
 * @param text - The string.
 * @returns `true` if it does.
 */
function hasControlChar(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c < 0x20 || c === 0x7f) return true;
	}
	return false;
}

/** Records where a session starts. */
export const SessionBase = {
	/**
	 * Records `HEAD` and every modified, added or untracked file with its
	 * content hash (REQ-IDX-19).
	 *
	 * @param cwd - The project root.
	 * @returns The base; `null` outside git or past 200 dirty files (REQ-IDX-20).
	 */
	async capture(cwd: string): Promise<SessionBaseRecord | null> {
		if (!(await GitReader.isRepo(cwd))) return null;
		// A path with a control character could not round-trip through YAML, and
		// is never tagged anyway (REQ-IDX-26).
		const dirty = (await GitReader.statusEntries(cwd)).filter(
			(e) => !e.code.includes("D") && !hasControlChar(e.path),
		);
		if (dirty.length > MAX_SESSION_BASE_DIRTY) return null;
		const head = await GitReader.head(cwd);
		const files = dirty.flatMap((e) => {
			const hash = hashOf(cwd, e.path);
			return hash === null ? [] : [{ path: e.path, hash }];
		});
		return { ...(head !== null ? { commit: head } : {}), dirty: files };
	},
} as const;

/**
 * Checks REQ-IDX-24: the base exists, and `HEAD` descends from it.
 *
 * @param cwd - The project root.
 * @param base - The recorded base.
 * @returns The reason to stop, or `null` to go on.
 */
async function stopReason(
	cwd: string,
	base: SessionBaseRecord | undefined,
): Promise<StopReason | null> {
	if (base === undefined) return "no-base";
	if (base.commit === undefined) return null;
	if (!(await GitReader.commitExists(cwd, base.commit))) return "base-missing";
	const head = await GitReader.head(cwd);
	if (head === null || !(await GitReader.isAncestor(cwd, base.commit, head))) {
		return "base-not-ancestor";
	}
	return null;
}

/**
 * Says whether an untracked file is substantive, blank or binary. Git's diff
 * reports nothing for untracked files, so this applies git's own tests: a NUL
 * byte in the first 8,000 means binary; nothing but whitespace means blank.
 *
 * @param abs - The validated absolute path.
 * @returns The kind of change against an empty base.
 */
function untrackedKind(abs: ValidatedPath): DiffKind {
	const buf = fs.readFileSync(abs);
	if (buf.subarray(0, 8000).includes(0)) return "binary";
	return buf.toString("utf-8").trim().length === 0 ? "blank" : "changed";
}

/**
 * Gathers the touched paths (REQ-IDX-21, -22), before the unchanged filter.
 *
 * @param cwd - The project root.
 * @param base - The recorded base.
 * @returns The paths, the untracked subset, and whether user.email was unset.
 */
async function touchedPaths(
	cwd: string,
	base: SessionBaseRecord,
): Promise<{ paths: string[]; untracked: Set<string>; noUserEmail: boolean }> {
	const email = await GitReader.userEmail(cwd);
	const head = await GitReader.head(cwd);
	const committed =
		email === null || head === null
			? []
			: await GitReader.committedBy(cwd, base.commit ?? null, email);
	const status = (await GitReader.statusEntries(cwd)).filter((e) => !e.code.includes("D"));
	const untracked = new Set(status.filter((e) => e.code === "??").map((e) => e.path));
	const paths = [...new Set([...committed, ...status.map((e) => e.path)])].sort();
	return { paths, untracked, noUserEmail: email === null };
}

/** Finds what a session touched. */
export const TouchDetector = {
	/**
	 * Lists the files touched since the base, with git's facts about each.
	 *
	 * @param cwd - The project root.
	 * @param base - The recorded base, or `undefined` when there is none.
	 * @returns The observation; `stopped` is set when nothing was looked at.
	 */
	async detect(cwd: string, base: SessionBaseRecord | undefined): Promise<TouchObservation> {
		const stopped = await stopReason(cwd, base);
		if (stopped !== null || base === undefined) {
			return {
				stopped: stopped ?? "no-base",
				noUserEmail: false,
				unchangedSinceBase: 0,
				candidates: [],
			};
		}
		const { paths, untracked, noUserEmail } = await touchedPaths(cwd, base);
		const atBase = new Map(base.dirty.map((d) => [d.path, d.hash]));
		const fresh = paths.filter((p) => !atBase.has(p) || atBase.get(p) !== hashOf(cwd, p));
		const live = fresh.flatMap((p) => {
			const abs = existing(cwd, p);
			return abs === null ? [] : [{ p, abs }];
		});
		const tracked = live.filter(({ p }) => !untracked.has(p)).map(({ p }) => p);
		const diff = await GitReader.substantive(cwd, base.commit ?? null, tracked);
		const generated = await GitReader.attribute(
			cwd,
			live.map(({ p }) => p),
			"linguist-generated",
		);
		const kinds = new Map(
			live.map(({ p, abs }) => [
				p,
				untracked.has(p) ? untrackedKind(abs) : (diff.get(p) ?? "blank"),
			]),
		);
		const candidates = fresh.map((p) => ({
			path: p,
			exists: kinds.has(p),
			change: kinds.get(p) ?? "blank",
			generated: generated.has(p),
		}));
		return { noUserEmail, unchangedSinceBase: paths.length - fresh.length, candidates };
	},
} as const;

/**
 * The first REQ-IDX-25..29 reason a candidate is not tagged, if any.
 *
 * @param c - The candidate.
 * @param excluded - Always-include and tool-owned paths.
 * @returns The reason, or `null` when the file survives.
 */
function filterReason(c: TouchCandidate, excluded: ReadonlySet<string>): SkipReason | null {
	if (!c.exists || isAlwaysIgnored(c.path) || excluded.has(c.path)) return "excluded-path";
	if (!PATH_SHAPED.test(c.path)) return "unsafe-path";
	if (LOCKFILE_NAMES.has(c.path.slice(c.path.lastIndexOf("/") + 1))) return "lockfile";
	if (c.change === "binary" || c.generated) return "binary-or-generated";
	if (c.change === "blank") return "whitespace-only";
	return null;
}

/**
 * Adds to a reason's count.
 *
 * @param map - The counts.
 * @param reason - The reason.
 * @param n - How many.
 */
function count(map: Map<SkipReason, number>, reason: SkipReason, n = 1): void {
	if (n > 0) map.set(reason, (map.get(reason) ?? 0) + n);
}

/**
 * Chunks to tag each survivor to: the active chunk, then each open chunk
 * that names the file (REQ-IDX-32, -33).
 *
 * @param input - The decision input.
 * @param survivors - Paths that passed every filter.
 * @returns File → chunks.
 */
function chunksFor(input: TouchDecisionInput, survivors: readonly string[]): Map<string, number[]> {
	const done = new Set(input.completed);
	const open = input.chunks.filter((c) => !done.has(c.chunk_id));
	const walked = [...new Set([...input.walked, ...survivors])];
	const named = referencedFiles(open, walked);
	return new Map(
		survivors.map((p) => {
			const others = (named.get(p) ?? []).filter((id) => id !== input.activeChunk);
			return [p, [input.activeChunk, ...others]];
		}),
	);
}

/** Decides which touched files get which chunks. */
export const TouchTagger = {
	/**
	 * Applies REQ-IDX-25..33 in order. Pure.
	 *
	 * @param input - The observation and the session's plan and index.
	 * @returns The tags to add and the count of files skipped for each reason.
	 */
	decide(input: TouchDecisionInput): TouchDecision {
		const o = input.observation;
		const skipped = new Map<SkipReason, number>();
		const base = { skipped, noUserEmail: o.noUserEmail };
		if (o.stopped !== undefined) return { ...base, tags: new Map(), stopped: o.stopped };
		count(skipped, "unchanged-since-base", o.unchangedSinceBase);

		const always = input.entries.filter((e) => e.chunk_tags.includes(0)).map((e) => e.filepath);
		const excluded = new Set([...always, ...input.toolOwned]);
		const survivors: string[] = [];
		for (const c of o.candidates) {
			const reason = filterReason(c, excluded);
			if (reason === null) survivors.push(c.path);
			else count(skipped, reason);
		}
		if (survivors.length > MAX_TOUCH_TAGS) {
			count(skipped, "too-many", survivors.length);
			return { ...base, tags: new Map() };
		}
		const active = input.chunks.find((c) => c.chunk_id === input.activeChunk);
		if (
			active !== undefined &&
			active.tasks.length > 0 &&
			active.tasks.every((t) => t.status === "done")
		) {
			count(skipped, "chunk-done", survivors.length);
			return { ...base, tags: new Map() };
		}
		return { ...base, tags: chunksFor(input, survivors) };
	},
} as const;
