/**
 * Schema for `.session/context-manifest.json` — the record of what the current
 * `NEXT_PROMPT.md` put into context, at what granularity, at what cost, and
 * why (LLD-code-units.md, REQ-UNIT-16..18).
 *
 * Written alongside every prompt and overwritten with it. `verify` reads it
 * back to report references the code has since moved past.
 *
 * @packageDocumentation
 */

import { z } from "zod";

/** Filename of the manifest within `.session/`. */
export const CONTEXT_MANIFEST_FILENAME = "context-manifest.json";

/** How much of an item the prompt loads. */
export const ManifestGranularitySchema = z.enum(["summary", "signature", "unit", "file"]);

/** Why an item is in the prompt. */
export const ManifestReasonSchema = z.enum(["always-include", "chunk", "task"]);

/** One item the prompt references. */
export const ManifestEntrySchema = z
	.object({
		/** `path` for a file, `path#id` for a code unit. */
		ref: z.string().min(1),
		/** Repo-relative file path. */
		path: z.string().min(1),
		/** How much of the item is loaded. */
		granularity: ManifestGranularitySchema,
		/** Token cost at that granularity. */
		tokens: z.number().int().nonnegative(),
		/** Token cost of the whole file — the comparison point for `tokens`. */
		file_tokens: z.number().int().nonnegative(),
		/** Content hash: the unit's for a unit, the file's otherwise. Absent when unknown. */
		hash: z.string().min(1).optional(),
		/** First line of a unit, 1-based. */
		start: z.number().int().positive().optional(),
		/** Last line of a unit, 1-based inclusive. */
		end: z.number().int().positive().optional(),
		/** Why the item is included. */
		reason: ManifestReasonSchema,
		/** Text of the task that caused it, when `reason` is `task`. Quoted plan text. */
		task: z.string().optional(),
		/** Whether the prompt names the item, or only covers it with `+N more`. */
		listed: z.boolean(),
		/**
		 * Why this declaration was chosen when its name had several (REQ-UNIT-33),
		 * e.g. `imported by 2 files`.
		 */
		evidence: z.string().optional(),
	})
	.strict();

/** The manifest document. */
export const ContextManifestSchema = z
	.object({
		version: z.literal(1),
		/** ISO 8601 time the prompt was generated. */
		generated_at: z.string().min(1),
		/** Active chunk the prompt was generated for. */
		active_chunk: z.number(),
		/** Content hash of the `NEXT_PROMPT.md` this manifest describes. */
		prompt_hash: z.string().min(1),
		entries: z.array(ManifestEntrySchema),
		totals: z
			.object({
				/** Sum of every entry's `tokens`. */
				tokens: z.number().int().nonnegative(),
				/** Sum of `file_tokens` over distinct paths — loading every file whole. */
				file_tokens: z.number().int().nonnegative(),
			})
			.strict(),
	})
	.strict();

/** One manifest entry. */
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/** A parsed context manifest. */
export type ContextManifestData = z.infer<typeof ContextManifestSchema>;
