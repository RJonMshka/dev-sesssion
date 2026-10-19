/**
 * ContextManifest — builds, writes and reads `.session/context-manifest.json`
 * (LLD-code-units.md, REQ-UNIT-16..18).
 *
 * The manifest makes a prompt traceable: every file or code unit the prompt
 * points at, how much of it is loaded, what that costs against loading the
 * whole file, the content hash it was taken from, and the task (if any) that
 * put it there.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, ParseError, PathValidator } from "@dev-session/security";
import type { AiIndex } from "../annotation/types.js";
import { contentHash } from "../annotation/unit-extractor.js";
import type { ContextPlan, ResolvedFileLayer } from "../calculators/layer-resolver.js";
import type { FocusedUnit } from "../calculators/unit-focus.js";
import { FOCUS_PREFIX, formatUnitRef } from "../formatters/formatter-utils.js";
import {
	CONTEXT_MANIFEST_FILENAME,
	type ContextManifestData,
	ContextManifestSchema,
	type ManifestEntry,
} from "../schemas/context-manifest.js";
import { extractDeclaredFiles } from "../verifiers/replay-scorer.js";

/** Inputs for {@link ContextManifest.build}. */
export interface ManifestInput {
	/** The resolved layers and focused units the prompt was generated from. */
	readonly plan: ContextPlan;
	/** The ai-index, for file hashes. `null` when none exists. */
	readonly index: AiIndex | null;
	/** The exact prompt text being written. */
	readonly prompt: string;
	/** The active chunk id. */
	readonly activeChunk: number;
	/** Generation time; defaults to now. */
	readonly now?: Date;
}

/** Relative path used in error messages — never the absolute one. */
const MANIFEST_DISPLAY_PATH = `.session/${CONTEXT_MANIFEST_FILENAME}`;

/** Layer → manifest granularity. */
const LAYER_GRANULARITY = { 0: "summary", 1: "signature", 2: "file" } as const;

/** What the prompt actually names, so capped-away items can be told apart. */
interface PromptRefs {
	/** Files named on non-Focus load lines. */
	readonly files: ReadonlySet<string>;
	/** The Focus line, or `""`. */
	readonly focusLine: string;
}

/**
 * Reads which items the prompt names.
 *
 * @param prompt - The prompt text.
 * @returns Named files and the Focus line.
 */
function readPromptRefs(prompt: string): PromptRefs {
	const lines = prompt.split("\n").map((l) => l.trim());
	const focusLine = lines.find((l) => l.startsWith(FOCUS_PREFIX)) ?? "";
	const rest = lines.filter((l) => !l.startsWith(FOCUS_PREFIX)).join("\n");
	return { files: new Set(extractDeclaredFiles(rest)), focusLine };
}

/**
 * Builds the entry for a focused unit.
 *
 * @param unit - The focused unit.
 * @param refs - What the prompt names.
 * @returns The manifest entry.
 */
function unitEntry(unit: FocusedUnit, refs: PromptRefs): ManifestEntry {
	return {
		ref: unit.ref,
		path: unit.filepath,
		granularity: "unit",
		tokens: unit.tokens,
		file_tokens: unit.fileTokens,
		hash: unit.hash,
		start: unit.start,
		end: unit.end,
		reason: "task",
		task: unit.task,
		listed: refs.focusLine.includes(formatUnitRef(unit)),
		...(unit.evidence !== undefined ? { evidence: unit.evidence } : {}),
	};
}

/**
 * Builds the entry for a file at its resolved layer.
 *
 * @param layer - The resolved file layer.
 * @param index - The ai-index, for the file hash.
 * @param refs - What the prompt names.
 * @returns The manifest entry.
 */
function fileEntry(
	layer: ResolvedFileLayer,
	index: AiIndex | null,
	refs: PromptRefs,
): ManifestEntry {
	const hash = index?.files[layer.filepath]?.hash;
	const reason = layer.escalated ? "task" : layer.role;
	// Without an index, formatters emit a flat `Load:` line of whole files.
	const whole = index === null;
	return {
		ref: layer.filepath,
		path: layer.filepath,
		granularity: whole ? "file" : LAYER_GRANULARITY[layer.layer],
		tokens: whole ? layer.fullTokenCost : layer.layeredTokenCost,
		file_tokens: layer.fullTokenCost,
		...(hash !== undefined ? { hash } : {}),
		reason,
		...(layer.escalatedBy !== undefined ? { task: layer.escalatedBy } : {}),
		listed: refs.files.has(layer.filepath),
	};
}

/**
 * Sums entry costs, counting each file once in the whole-file equivalent.
 *
 * @param entries - The manifest entries.
 * @returns The totals block.
 */
function totals(entries: readonly ManifestEntry[]): ContextManifestData["totals"] {
	const perPath = new Map<string, number>();
	for (const e of entries) perPath.set(e.path, e.file_tokens);
	return {
		tokens: entries.reduce((n, e) => n + e.tokens, 0),
		file_tokens: [...perPath.values()].reduce((n, t) => n + t, 0),
	};
}

/**
 * Recursively sorts object keys so serialization is byte-stable.
 *
 * @param value - Any JSON value.
 * @returns The same value with every object's keys in sorted order.
 */
function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Object.keys(value).sort()) {
		out[key] = sortKeys((value as Record<string, unknown>)[key]);
	}
	return out;
}

/**
 * Builds, persists, and loads the context manifest.
 */
export const ContextManifest = {
	/**
	 * Builds the manifest for a generated prompt. Pure.
	 *
	 * Focused units come first, then files in resolution order.
	 *
	 * @param input - The plan, index, prompt text and chunk.
	 * @returns The manifest.
	 */
	build(input: ManifestInput): ContextManifestData {
		const refs = readPromptRefs(input.prompt);
		const entries = [
			...input.plan.focus.map((u) => unitEntry(u, refs)),
			...input.plan.layers.map((l) => fileEntry(l, input.index, refs)),
		];
		return {
			version: 1,
			generated_at: (input.now ?? new Date()).toISOString(),
			active_chunk: input.activeChunk,
			prompt_hash: contentHash(input.prompt),
			entries,
			totals: totals(entries),
		};
	},

	/**
	 * Serializes a manifest as JSON with sorted keys and a trailing newline.
	 *
	 * @param manifest - The manifest.
	 * @returns Deterministic JSON text.
	 */
	serialize(manifest: ContextManifestData): string {
		return `${JSON.stringify(sortKeys(manifest), null, 2)}\n`;
	},

	/**
	 * Writes the manifest into `.session/` atomically.
	 *
	 * @param sessionDir - Validated path to `.session/`.
	 * @param manifest - The manifest to write.
	 * @throws {SecurityError} If the secret guard blocks the write.
	 */
	write(sessionDir: ValidatedPath, manifest: ContextManifestData): void {
		const target = PathValidator.safeResolvePath(CONTEXT_MANIFEST_FILENAME, sessionDir);
		AtomicWriter.writeFile(target, this.serialize(manifest));
	},

	/**
	 * Loads the manifest from `.session/`.
	 *
	 * @param sessionDir - Validated path to `.session/`.
	 * @returns The manifest, or `null` when none has been written.
	 * @throws {ParseError} If the file exists but is not a valid manifest.
	 */
	load(sessionDir: ValidatedPath): ContextManifestData | null {
		const target = PathValidator.safeResolvePath(CONTEXT_MANIFEST_FILENAME, sessionDir);
		if (!fs.existsSync(target)) return null;
		let raw: unknown;
		try {
			raw = JSON.parse(fs.readFileSync(target, "utf-8"));
		} catch (cause: unknown) {
			throw new ParseError({
				message: "context-manifest.json is not valid JSON",
				file: MANIFEST_DISPLAY_PATH,
				cause,
			});
		}
		const parsed = ContextManifestSchema.safeParse(raw);
		if (!parsed.success) {
			throw new ParseError({
				message: `context-manifest.json does not match the schema: ${parsed.error.issues[0]?.message ?? "invalid"}`,
				file: MANIFEST_DISPLAY_PATH,
			});
		}
		return parsed.data;
	},
} as const;
