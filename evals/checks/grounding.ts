/**
 * Deterministic path-grounding check.
 *
 * Every file path the generated context names must exist. A context generator
 * that invents paths is the most damaging real-world failure mode and it needs
 * no judge to detect — so this runs first and costs nothing.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { GroundingResult } from "../types.js";

/**
 * Prefixes the formatters emit for file-load lines.
 * Longest-first: `Load full:` must win over `Load:`.
 */
const LOAD_PREFIXES: readonly string[] = [
	"Summaries (read_file_layer for detail):",
	"Files to load:",
	"Load full:",
	"Load:",
];

/** Trailing `·L<n>` layer marker appended to summary refs. */
const LAYER_SUFFIX_RE = /·L\d+$/;

/** `+N more` truncation suffix, and the empty-list sentinel. */
const MORE_RE = /^\+\d+ more$/;
const NONE_SENTINEL = "(none)";

/**
 * Extracts declared file references from a NEXT_PROMPT-style line list.
 *
 * @param prompt - Raw NEXT_PROMPT.md content.
 * @returns Repo-relative paths, deduplicated.
 */
export function declaredFromPrompt(prompt: string): string[] {
	const found = new Set<string>();
	for (const raw of prompt.split("\n")) {
		const line = raw.trim();
		const prefix = LOAD_PREFIXES.find((p) => line.startsWith(p));
		if (prefix === undefined) continue;
		const rest = line.slice(prefix.length).trim();
		if (rest === NONE_SENTINEL || rest === "") continue;
		for (const part of rest.split(",")) {
			const ref = normalizeRef(part);
			// `+11 more` is a truncation marker, not a path.
			if (ref === "" || MORE_RE.test(ref)) continue;
			found.add(ref);
		}
	}
	return [...found];
}

/**
 * Extracts declared file references from an adapter file's bullet list.
 *
 * NEXT_PROMPT caps its list with `+N more`, so the adapter output (CLAUDE.md and
 * friends) is the only place the full set appears.
 *
 * @param adapterFile - Raw adapter file content.
 * @returns Repo-relative paths, deduplicated.
 */
export function declaredFromAdapterFile(adapterFile: string): string[] {
	const found = new Set<string>();
	let inList = false;
	for (const raw of adapterFile.split("\n")) {
		const line = raw.trim();
		if (line.startsWith("#") && /files to load/i.test(line)) {
			inList = true;
			continue;
		}
		if (inList && line.startsWith("#")) break;
		if (!inList) continue;
		const m = /^[-*]\s+`([^`]+)`\s*$/.exec(line);
		if (m?.[1] !== undefined) found.add(normalizeRef(m[1]));
	}
	return [...found];
}

/**
 * Normalizes a rendered file reference to a repo-relative path.
 *
 * Adapters decorate refs: the Claude formatter prefixes `@` (its mention
 * syntax) and layered output appends a `\u00b7L<n>` marker.
 *
 * @param raw - Raw reference as rendered.
 * @returns The bare repo-relative path.
 */
function normalizeRef(raw: string): string {
	return raw.trim().replace(LAYER_SUFFIX_RE, "").replace(/^@/, "").trim();
}

/**
 * Extracts declared file references from FILE_INDEX.md.
 *
 * This is the only place the *complete* chunk file list appears — NEXT_PROMPT
 * caps its list with `+N more` and the adapter file only points here.
 *
 * @param fileIndex - Raw FILE_INDEX.md content.
 * @returns Repo-relative paths, deduplicated.
 */
export function declaredFromFileIndex(fileIndex: string): string[] {
	const found = new Set<string>();
	for (const raw of fileIndex.split("\n")) {
		const line = raw.trim();
		if (!line.startsWith("|")) continue;
		const cells = line.split("|").map((c) => c.trim());
		const first = cells[1];
		if (first === undefined || first === "" || first === "File") continue;
		if (/^-+$/.test(first)) continue;
		found.add(normalizeRef(first));
	}
	return [...found];
}

/**
 * Checks that every declared path exists in the workspace.
 *
 * @param workspaceDir - Absolute path to the workspace root.
 * @param declared - Repo-relative paths the context declared.
 * @returns Which paths are missing and the grounded ratio.
 */
export async function checkGrounding(
	workspaceDir: string,
	declared: readonly string[],
): Promise<GroundingResult> {
	const missing: string[] = [];
	for (const rel of declared) {
		// Glob directives (Do NOT load) never reach here; these are literal paths.
		try {
			await fs.access(path.join(workspaceDir, rel));
		} catch {
			missing.push(rel);
		}
	}
	return {
		declared: [...declared],
		missing,
		groundedRatio:
			declared.length === 0 ? null : (declared.length - missing.length) / declared.length,
	};
}

/**
 * Finds file references the prompt lists more than once.
 *
 * The prompt caps its file list, so a duplicate burns a slot that a real file
 * would otherwise occupy.
 *
 * @param prompt - Raw NEXT_PROMPT.md content.
 * @returns Each duplicated path, once.
 */
export function duplicatePromptRefs(prompt: string): string[] {
	const seen = new Set<string>();
	const dupes = new Set<string>();
	for (const raw of prompt.split("\n")) {
		const line = raw.trim();
		const prefix = LOAD_PREFIXES.find((pfx) => line.startsWith(pfx));
		if (prefix === undefined) continue;
		const rest = line.slice(prefix.length).trim();
		if (rest === NONE_SENTINEL || rest === "") continue;
		for (const part of rest.split(",")) {
			const ref = normalizeRef(part);
			if (ref === "" || MORE_RE.test(ref)) continue;
			if (seen.has(ref)) dupes.add(ref);
			seen.add(ref);
		}
	}
	return [...dupes];
}
