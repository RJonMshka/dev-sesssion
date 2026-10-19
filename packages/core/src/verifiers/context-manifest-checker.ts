/**
 * ContextManifestChecker — compares a context manifest against the code as it
 * stands now (LLD-code-units.md, REQ-UNIT-20..22).
 *
 * A prompt names units by line range. Once a session edits the code, those
 * ranges can point at the wrong lines or at code that no longer exists. This
 * re-extracts each referenced file and reports what drifted, so `verify` can
 * say "regenerate the prompt" before the next session acts on stale pointers.
 *
 * Needs no git: it reads the working tree.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import { PathValidator } from "@dev-session/security";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { ParsedFile } from "../annotation/types.js";
import type { ContextManifestData, ManifestEntry } from "../schemas/context-manifest.js";
import type { VerifyFinding } from "./session-verifier.js";

/** Refs shown per finding before summarizing the rest. */
const MAX_REFS_SHOWN = 5;

/** How each checked entry compares with the current code. */
interface Drift {
	readonly changed: string[];
	readonly removed: string[];
	readonly moved: string[];
}

/**
 * Re-extracts a manifest path, refusing anything outside the project root.
 *
 * @param relPath - The entry's repo-relative path.
 * @param projectRoot - The project root.
 * @returns The current extraction, or `null` when the file is gone or refused.
 */
function extractCurrent(relPath: string, projectRoot: string): ParsedFile | null {
	try {
		const abs = PathValidator.safeResolvePath(relPath, projectRoot);
		if (!fs.existsSync(abs)) return null;
		return new AutoExtractor().extractFile(abs);
	} catch {
		return null;
	}
}

/**
 * Classifies one unit entry against the file's current units.
 *
 * @param entry - A unit-granularity manifest entry.
 * @param current - The file as extracted now, or `null` when gone.
 * @param drift - Accumulator.
 */
function classifyUnit(entry: ManifestEntry, current: ParsedFile | null, drift: Drift): void {
	const id = entry.ref.slice(entry.ref.indexOf("#") + 1);
	const now = current?.units.find((u) => u.id === id);
	if (now === undefined) drift.removed.push(entry.ref);
	else if (now.hash !== entry.hash) drift.changed.push(entry.ref);
	else if (now.start !== entry.start || now.end !== entry.end) drift.moved.push(entry.ref);
}

/**
 * Classifies one whole-file entry by its file hash.
 *
 * Summary and signature entries are not checked: those are rendered on demand
 * from the ai-index, so the manifest holds no line range that could go stale.
 *
 * @param entry - A file-granularity manifest entry with a hash.
 * @param current - The file as extracted now, or `null` when gone.
 * @param drift - Accumulator.
 */
function classifyFile(entry: ManifestEntry, current: ParsedFile | null, drift: Drift): void {
	if (current === null) drift.removed.push(entry.ref);
	else if (current.hash !== entry.hash) drift.changed.push(entry.ref);
}

/**
 * Formats a capped list of refs.
 *
 * @param refs - The refs.
 * @returns A display string.
 */
function list(refs: readonly string[]): string {
	const shown = refs.slice(0, MAX_REFS_SHOWN).join(", ");
	const rest = refs.length - MAX_REFS_SHOWN;
	return rest > 0 ? `${shown}, +${String(rest)} more` : shown;
}

/**
 * Turns accumulated drift into findings.
 *
 * @param drift - What drifted.
 * @returns Zero to two findings.
 */
function toFindings(drift: Drift): VerifyFinding[] {
	const findings: VerifyFinding[] = [];
	const stale: string[] = [];
	if (drift.changed.length > 0) stale.push(`changed: ${list(drift.changed)}`);
	if (drift.removed.length > 0) stale.push(`removed: ${list(drift.removed)}`);
	if (stale.length > 0) {
		findings.push({
			severity: "warning",
			code: "STALE_CONTEXT",
			message: `NEXT_PROMPT.md points at code that has since changed (${stale.join("; ")}) — run \`dev-sesssion update\` to regenerate it`,
		});
	}
	if (drift.moved.length > 0) {
		findings.push({
			severity: "info",
			code: "MOVED_CONTEXT",
			message: `Focused units are unchanged but their line ranges moved: ${list(drift.moved)}`,
		});
	}
	return findings;
}

/**
 * Checks a context manifest against the working tree.
 */
export const ContextManifestChecker = {
	/**
	 * Reports manifest entries whose code changed, moved, or disappeared.
	 *
	 * @param manifest - The manifest written beside the current prompt.
	 * @param projectRoot - The project root the manifest's paths are relative to.
	 * @returns Findings, at most one per code.
	 */
	check(manifest: ContextManifestData, projectRoot: string): VerifyFinding[] {
		const drift: Drift = { changed: [], removed: [], moved: [] };
		const cache = new Map<string, ParsedFile | null>();
		const current = (p: string): ParsedFile | null => {
			if (!cache.has(p)) cache.set(p, extractCurrent(p, projectRoot));
			return cache.get(p) ?? null;
		};

		for (const entry of manifest.entries) {
			if (entry.hash === undefined) continue;
			if (entry.granularity === "unit") classifyUnit(entry, current(entry.path), drift);
			else if (entry.granularity === "file") classifyFile(entry, current(entry.path), drift);
		}
		return toFindings(drift);
	},
} as const;
