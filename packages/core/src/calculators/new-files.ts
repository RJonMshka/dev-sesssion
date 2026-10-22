/**
 * Files a chunk will create (LLD-new-files.md, area NEW).
 *
 * A plan names paths that may not exist yet. The prompt states them, and loads
 * the indexed files beside each one — the code a new file plugs into and the
 * conventions it should follow. Absence may also mean the code moved on from
 * the plan, so the prompt reports "not on disk", never "to create".
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PathValidator } from "@dev-session/security";
import type { AiIndex } from "../annotation/types.js";
import type { FileIndexEntry, PlanChunk } from "../schemas/index.js";

/**
 * Characters a stated path may hold (REQ-NEW-2). The line renders plan text
 * outside any quotation, so the path must be path-shaped by construction.
 */
const PATH_SHAPED = /^[A-Za-z0-9._\-+@/]+$/;

/** Neighbours loaded per absent path (REQ-NEW-4). */
const PER_PATH = 3;

/** Neighbours loaded per chunk (REQ-NEW-4). */
const PER_CHUNK = 8;

/** Inputs for {@link NewFiles.neighbours}. */
export interface NeighbourInput {
	/** Absent paths, from {@link NewFiles.absent}. */
	readonly absent: readonly string[];
	/** The ai-index, or `null` when there is none. */
	readonly index: AiIndex | null;
	/** Paths already loaded or trimmed; never chosen. */
	readonly taken: ReadonlySet<string>;
	/** The active chunk, which each neighbour is tagged to. */
	readonly activeChunk: number;
}

/**
 * Whether the path exists under the project root. A path the validator
 * rejects counts as existing, so it is never stated.
 *
 * @param rel - Plan-named path.
 * @param projectRoot - Project root.
 * @returns `true` when the file exists or the path is unsafe.
 */
function existsOrUnsafe(rel: string, projectRoot: string): boolean {
	try {
		return fs.existsSync(PathValidator.safeResolvePath(rel, projectRoot));
	} catch {
		return true;
	}
}

/**
 * Whether a known file is the path, or ends with it at a segment boundary —
 * the tail match the tagging matcher uses (REQ-RUN-2), so `src/lifecycle.ts`
 * names `apps/x/src/lifecycle.ts` here as it does there.
 *
 * @param rel - Plan-named path.
 * @param known - Indexed and tagged paths.
 * @returns `true` when a known file carries that name.
 */
function namesKnownFile(rel: string, known: readonly string[]): boolean {
	return known.some((f) => f === rel || f.endsWith(`/${rel}`));
}

/**
 * Groups indexed paths by their directory.
 *
 * @param index - The ai-index.
 * @returns Directory (posix, `""` for the root) → paths directly inside it.
 */
function byDirectory(index: AiIndex): Map<string, string[]> {
	const dirs = new Map<string, string[]>();
	for (const file of Object.keys(index.files)) {
		const dir = path.posix.dirname(file);
		const list = dirs.get(dir) ?? [];
		list.push(file);
		dirs.set(dir, list);
	}
	return dirs;
}

/**
 * Indexed files beside one absent path: those in the nearest ancestor
 * directory below the root that holds any, same extension first, then path
 * order, less those already taken.
 *
 * @param absent - The absent path.
 * @param dirs - Indexed paths by directory.
 * @param taken - Paths never chosen.
 * @returns Up to {@link PER_PATH} paths.
 */
function besideOne(
	absent: string,
	dirs: ReadonlyMap<string, readonly string[]>,
	taken: ReadonlySet<string>,
): string[] {
	const ext = path.posix.extname(absent);
	for (let dir = path.posix.dirname(absent); dir !== "." && dir !== ""; ) {
		const inDir = dirs.get(dir);
		if (inDir !== undefined) {
			// The nearest directory with indexed files is the one; files already
			// loaded leave fewer, never a climb to a farther directory.
			const sameExt = (f: string): number => (path.posix.extname(f) === ext ? 0 : 1);
			return inDir
				.filter((f) => !taken.has(f))
				.sort((a, b) => sameExt(a) - sameExt(b) || a.localeCompare(b))
				.slice(0, PER_PATH);
		}
		const parent = path.posix.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return [];
}

/**
 * Finds the files a chunk will create and the code beside them.
 */
export const NewFiles = {
	/**
	 * Plan-named paths of the active chunk that are not on disk
	 * (REQ-NEW-1..3).
	 *
	 * A plan's prose yields bare names and expressions (`node.props`) and
	 * partial paths (`src/lifecycle.ts`). Only a path with a directory is
	 * stated, and only when it is neither on disk nor the tail of a file the
	 * index knows.
	 *
	 * @param chunk - The active chunk.
	 * @param projectRoot - The project root.
	 * @param entries - `FILE_INDEX.md` entries.
	 * @param index - The ai-index, or `null`.
	 * @returns Path-shaped, in-root paths that do not exist, in plan order;
	 *   none when every task is done.
	 */
	absent(
		chunk: PlanChunk,
		projectRoot: string,
		entries: readonly FileIndexEntry[],
		index: AiIndex | null,
	): string[] {
		const files = chunk.files ?? [];
		const finished = chunk.tasks.length > 0 && chunk.tasks.every((t) => t.status === "done");
		if (finished) return [];
		const known = [...Object.keys(index?.files ?? {}), ...entries.map((e) => e.filepath)];
		return files.filter(
			(f) =>
				f.includes("/") &&
				PATH_SHAPED.test(f) &&
				!namesKnownFile(f, known) &&
				!existsOrUnsafe(f, projectRoot),
		);
	},

	/**
	 * Indexed files beside each absent path, as chunk entries (REQ-NEW-4).
	 *
	 * @param input - Absent paths, the ai-index, taken paths, active chunk.
	 * @returns At most {@link PER_CHUNK} entries tagged to the active chunk.
	 */
	neighbours(input: NeighbourInput): FileIndexEntry[] {
		const { absent, index, activeChunk } = input;
		if (index === null || absent.length === 0) return [];
		const dirs = byDirectory(index);
		const taken = new Set(input.taken);
		const entries: FileIndexEntry[] = [];
		for (const file of absent) {
			for (const filepath of besideOne(file, dirs, taken)) {
				if (entries.length >= PER_CHUNK) return entries;
				taken.add(filepath);
				entries.push({ filepath, chunk_tags: [activeChunk], purpose: `Beside ${file}` });
			}
		}
		return entries;
	},
} as const;
