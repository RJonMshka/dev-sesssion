/**
 * Context recall — does the generated context point at the files a chunk's work
 * needs? (LLD-eval-harness.md, REQ-EVAL-10..12)
 *
 * Grounding catches a context that names files that do not exist. This catches
 * the opposite failure, which every other check passes: a context that names
 * nothing useful at all.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** FILE_INDEX.md rows, split by section. */
export interface FileIndexSections {
	/** Rows under `## Always Include` — loaded for every chunk. */
	readonly alwaysInclude: readonly string[];
	/** Rows under each `## Chunk N` heading, keyed by chunk id. */
	readonly chunks: ReadonlyMap<number, readonly string[]>;
}

/** Recall of a declared file set against what the context named. */
export interface RecallScore {
	readonly hit: number;
	readonly total: number;
	/** hit / total; null when nothing was declared, so absence never scores 0. */
	readonly ratio: number | null;
	/** Declared files the context did not name. */
	readonly missed: readonly string[];
}

const CHUNK_HEADING_RE = /^##\s+Chunk\s+(\d+(?:\.\d+)?)\b/;
const ALWAYS_HEADING_RE = /^##\s+Always Include\b/i;

/**
 * Splits FILE_INDEX.md rows by the section they appear under.
 *
 * The format is PROTOCOL.md's; the harness never imports the generator's parser,
 * so this re-implements the part it needs.
 *
 * @param fileIndex - Raw FILE_INDEX.md content.
 * @returns Always-include rows and per-chunk rows.
 */
export function fileIndexByChunk(fileIndex: string): FileIndexSections {
	const alwaysInclude: string[] = [];
	const chunks = new Map<number, string[]>();
	let current: string[] | null = null;

	for (const raw of fileIndex.split("\n")) {
		const line = raw.trim();
		if (line.startsWith("## ")) {
			const chunk = CHUNK_HEADING_RE.exec(line);
			if (chunk?.[1] !== undefined) {
				const id = Number.parseFloat(chunk[1]);
				current = chunks.get(id) ?? [];
				chunks.set(id, current);
			} else {
				current = ALWAYS_HEADING_RE.test(line) ? alwaysInclude : null;
			}
			continue;
		}
		if (current === null || !line.startsWith("|")) continue;
		const first = line.split("|")[1]?.trim();
		if (first === undefined || first === "" || first === "File" || /^-+$/.test(first)) continue;
		current.push(first);
	}
	return { alwaysInclude, chunks };
}

/**
 * Scores how many declared files the context named.
 *
 * @param declared - Files the chunk's work needs, already filtered to those on disk.
 * @param named - Files the context directs the agent to.
 * @returns The recall score.
 */
export function scoreRecall(declared: readonly string[], named: readonly string[]): RecallScore {
	const namedSet = new Set(named);
	const missed = declared.filter((f) => !namedSet.has(f));
	const hit = declared.length - missed.length;
	return {
		hit,
		total: declared.length,
		ratio: declared.length === 0 ? null : hit / declared.length,
		missed,
	};
}

/**
 * Whether prompt recall is a failure: files were declared, and none were named.
 *
 * Partial recall is reported, not failed — the threshold for "useful enough" is
 * not known yet. Zero is unambiguous: the context gave the agent nothing.
 *
 * @param score - Prompt recall for the active chunk.
 * @returns True when the run should fail.
 */
export function promptRecallFailed(score: RecallScore): boolean {
	return score.total > 0 && score.hit === 0;
}

/**
 * Splits declared paths into those present in the workspace and those absent.
 *
 * A plan's file list drifts as code is written; the tool cannot be faulted for
 * not tagging a file that is not there, so absent files leave the denominator.
 *
 * @param workspaceDir - Absolute workspace root.
 * @param declared - Repo-relative declared paths.
 * @returns Present and absent paths, in declared order.
 */
export async function partitionPresent(
	workspaceDir: string,
	declared: readonly string[],
): Promise<{ present: string[]; absent: string[] }> {
	const present: string[] = [];
	const absent: string[] = [];
	for (const rel of declared) {
		try {
			const st = await fs.stat(path.join(workspaceDir, rel));
			(st.isFile() ? present : absent).push(rel);
		} catch {
			absent.push(rel);
		}
	}
	return { present, absent };
}
