/**
 * AnnotationParser — parses optional `@ai-*` JSDoc tags from a comment block.
 *
 * Chunk 12 extracts the public surface with zero annotations required. This
 * parser lets an author *correct* the auto-extracted index at the source when
 * the heuristic guesses wrong, via four optional tags:
 *
 * - `@ai-surface <public|private>` — override the detected visibility.
 * - `@ai-summary <text>` — override the one-line summary.
 * - `@ai-layer-hint <0|1|2>` (alias `@ai-layer-default`) — preferred load layer.
 *   Parsed and exposed here; the layered-loading wiring lands in Chunk 15.
 * - `@ai-tag <slug>` — free-form label for index queries (repeatable).
 *
 * Annotation values are untrusted input that ultimately flows into the
 * serialized `ai-index.yaml`. This parser is therefore strict by construction:
 * every value is validated against an allowlist (enums, a numeric range, or a
 * lowercase slug pattern). Anything that does not match — malformed values,
 * unknown tags, injection payloads, prototype-pollution keys — is dropped
 * silently rather than propagated. Parsing never throws.
 *
 * @packageDocumentation
 */

import type { SymbolSurface } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Preferred context layer for a symbol or file (consumed in Chunk 15). */
export type LayerHint = 0 | 1 | 2;

/**
 * The parsed result of the `@ai-*` tags in a single JSDoc comment block.
 *
 * Every field except {@link SymbolAnnotations.tags} is optional: it is present
 * only when a well-formed corresponding tag was found. Absent fields mean
 * "no override — keep the auto-extracted value".
 */
export interface SymbolAnnotations {
	/** Visibility override from `@ai-surface`. Absent if not specified/invalid. */
	readonly surface?: SymbolSurface;
	/** Summary override from `@ai-summary`. Absent if not specified/empty. */
	readonly summary?: string;
	/** Preferred load layer from `@ai-layer-hint`. Absent if not specified/invalid. */
	readonly layerHint?: LayerHint;
	/** Validated, sorted, de-duplicated `@ai-tag` slugs. Always present (may be empty). */
	readonly tags: readonly string[];
}

/**
 * Annotations for a whole file: the module-level block plus per-symbol blocks.
 *
 * Built by {@link AnnotationParser.collect}. `symbols` is keyed by symbol name
 * and constructed with a null prototype so untrusted names can never pollute
 * the prototype chain.
 */
export interface FileAnnotations {
	/** Annotations from the `@packageDocumentation` block (empty if none). */
	readonly module: SymbolAnnotations;
	/** Per-symbol annotations keyed by symbol name. */
	readonly symbols: Readonly<Record<string, SymbolAnnotations>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Matches a single `@ai-<key> <value>` directive on a JSDoc line.
 * Captures the key (group 1) and the trailing value (group 2, may be empty).
 * The key charset is restricted so a tag name can never smuggle metacharacters.
 */
const AI_TAG_RE = /^@ai-([a-z][a-z-]*)\b[ \t]*(.*)$/;

/** Allowlist for `@ai-tag` slugs: lowercase, starts alnum, `._-` allowed, ≤40 chars. */
const TAG_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Matches ASCII control characters (C0 range plus DEL) for stripping. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars in untrusted input
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

/** Max characters retained from an `@ai-summary` value. */
const MAX_SUMMARY_CHARS = 200;

/** Keys that must never be assigned, even as own-properties on a null-proto object. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Empty annotations singleton — frozen, with an always-empty tag list. */
const EMPTY_ANNOTATIONS: SymbolAnnotations = Object.freeze({ tags: Object.freeze([]) });

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses `@ai-*` annotation tags out of JSDoc comment blocks.
 *
 * Stateless; safe to share a single instance. All methods are pure and never
 * throw — invalid input degrades to "no annotation".
 *
 * @example
 * ```typescript
 * const parser = new AnnotationParser();
 * const ann = parser.parse("* Does a thing.\n * @ai-surface private\n * @ai-tag experimental");
 * ann.surface; // "private"
 * ann.tags;    // ["experimental"]
 * ```
 */
export class AnnotationParser {
	/**
	 * Parse the `@ai-*` tags from a single JSDoc comment block.
	 *
	 * Accepts the raw comment body as produced by `@typescript-eslint/typescript-estree`
	 * (the text between the comment delimiters, with leading `*` markers still on
	 * each line). Lines that are not `@ai-*` directives are ignored.
	 *
	 * @param commentValue - Raw JSDoc comment body. Empty string yields empty annotations.
	 * @returns The parsed, validated annotations for this block.
	 */
	parse(commentValue: string): SymbolAnnotations {
		if (commentValue.length === 0) {
			return EMPTY_ANNOTATIONS;
		}

		let surface: SymbolSurface | undefined;
		let summary: string | undefined;
		let layerHint: LayerHint | undefined;
		const tags = new Set<string>();

		for (const rawLine of commentValue.split("\n")) {
			// Strip the leading ` * ` JSDoc gutter, then look for a directive.
			const line = rawLine.replace(/^\s*\*+\s?/, "").trim();
			const match = AI_TAG_RE.exec(line);
			if (match?.[1] === undefined) {
				continue;
			}

			const key = match[1];
			const value = (match[2] ?? "").trim();

			switch (key) {
				case "surface": {
					// First well-formed value wins; later/invalid ones are ignored.
					surface ??= parseSurface(value);
					break;
				}
				case "summary": {
					summary ??= parseSummary(value);
					break;
				}
				case "layer-hint":
				case "layer-default": {
					layerHint ??= parseLayerHint(value);
					break;
				}
				case "tag": {
					const slug = parseTagSlug(value);
					if (slug !== undefined) {
						tags.add(slug);
					}
					break;
				}
				default:
					// Unknown @ai-* tag — ignored safely.
					break;
			}
		}

		return buildAnnotations(surface, summary, layerHint, tags);
	}

	/**
	 * Build {@link FileAnnotations} from a module block and a list of named symbol blocks.
	 *
	 * Convenience aggregate over {@link AnnotationParser.parse}. The returned
	 * `symbols` map uses a null prototype, so even a malicious symbol name
	 * (e.g. `"__proto__"`) is stored as a plain own-property and cannot corrupt
	 * the prototype chain.
	 *
	 * @param moduleBlock - The `@packageDocumentation` comment body (or `""`).
	 * @param symbolBlocks - Pairs of `[symbolName, commentBody]`.
	 * @returns Aggregated file annotations.
	 */
	collect(
		moduleBlock: string,
		symbolBlocks: ReadonlyArray<readonly [name: string, comment: string]>,
	): FileAnnotations {
		const symbols = Object.create(null) as Record<string, SymbolAnnotations>;
		for (const [name, comment] of symbolBlocks) {
			if (FORBIDDEN_KEYS.has(name)) {
				// Defensive: never assign a pollution key even as an own-property.
				continue;
			}
			symbols[name] = this.parse(comment);
		}
		return { module: this.parse(moduleBlock), symbols };
	}
}

// ---------------------------------------------------------------------------
// Value parsers (each returns `undefined` for malformed input)
// ---------------------------------------------------------------------------

/**
 * Parse an `@ai-surface` value.
 *
 * @param value - The trimmed tag value.
 * @returns `"public"` or `"private"`, or `undefined` if not one of those.
 */
function parseSurface(value: string): SymbolSurface | undefined {
	const v = value.toLowerCase();
	return v === "public" || v === "private" ? v : undefined;
}

/**
 * Parse an `@ai-summary` value: collapse whitespace, strip control characters,
 * and cap length. Control-character stripping defends the YAML serializer
 * against newline/escape injection even before its own quoting runs.
 *
 * @param value - The trimmed tag value.
 * @returns The cleaned summary, or `undefined` if empty after cleaning.
 */
function parseSummary(value: string): string | undefined {
	const cleaned = value.replace(CONTROL_CHARS_RE, " ").replace(/\s+/g, " ").trim();
	if (cleaned.length === 0) {
		return undefined;
	}
	return cleaned.length > MAX_SUMMARY_CHARS ? cleaned.slice(0, MAX_SUMMARY_CHARS) : cleaned;
}

/**
 * Parse an `@ai-layer-hint` / `@ai-layer-default` value.
 *
 * @param value - The trimmed tag value.
 * @returns `0`, `1`, or `2`, or `undefined` if out of range / non-numeric.
 */
function parseLayerHint(value: string): LayerHint | undefined {
	switch (value) {
		case "0":
			return 0;
		case "1":
			return 1;
		case "2":
			return 2;
		default:
			return undefined;
	}
}

/**
 * Parse and validate an `@ai-tag` slug against the allowlist.
 *
 * The lowercase-slug allowlist makes YAML injection and prototype pollution
 * impossible: any value containing whitespace, quotes, `:`, `{`, newlines, or a
 * forbidden key simply fails the pattern and is dropped.
 *
 * @param value - The trimmed tag value (only the first whitespace-delimited token is considered).
 * @returns The validated slug, or `undefined` if it fails validation.
 */
function parseTagSlug(value: string): string | undefined {
	// A tag is a single token; ignore anything trailing the first whitespace.
	const token = value.split(/\s+/)[0] ?? "";
	if (token.length === 0 || FORBIDDEN_KEYS.has(token)) {
		return undefined;
	}
	return TAG_SLUG_RE.test(token) ? token : undefined;
}

/**
 * Assemble a {@link SymbolAnnotations} object from parsed parts, omitting
 * absent optional fields (to satisfy `exactOptionalPropertyTypes`).
 *
 * @param surface - Parsed surface or `undefined`.
 * @param summary - Parsed summary or `undefined`.
 * @param layerHint - Parsed layer hint or `undefined`.
 * @param tags - The accumulated set of validated tag slugs.
 * @returns The finished, deterministic annotations object.
 */
function buildAnnotations(
	surface: SymbolSurface | undefined,
	summary: string | undefined,
	layerHint: LayerHint | undefined,
	tags: ReadonlySet<string>,
): SymbolAnnotations {
	if (
		surface === undefined &&
		summary === undefined &&
		layerHint === undefined &&
		tags.size === 0
	) {
		return EMPTY_ANNOTATIONS;
	}

	const result: {
		surface?: SymbolSurface;
		summary?: string;
		layerHint?: LayerHint;
		tags: readonly string[];
	} = {
		// Deterministic ordering for stable index serialization.
		tags: [...tags].sort(),
	};
	if (surface !== undefined) result.surface = surface;
	if (summary !== undefined) result.summary = summary;
	if (layerHint !== undefined) result.layerHint = layerHint;
	return result;
}
