/**
 * Types shared by every plan source.
 *
 * A plan source scores a raw plan document and, if selected, parses it into
 * {@link PlanChunk}s. `PlanChunk[]` is the seam: nothing downstream of
 * ingestion learns that plan formats vary.
 *
 * @packageDocumentation
 */

import type { PlanChunk } from "../../schemas/index.js";

/** A source's confidence that it understands a document, with the reason shown to users. */
export interface PlanSourceDetection {
	/** Confidence in the range 0..1. */
	readonly confidence: number;
	/** Short human-readable justification, surfaced when detection is ambiguous. */
	readonly reason: string;
}

/** Why a section was left out of the parsed chunks. */
export type ExclusionReason =
	/** The document declares positions and this section declared none. */
	| "no-position-declared"
	/** The declared position cannot be represented as a `chunk_id`. */
	| "unrepresentable-id";

/** A heading section that was recognized but deliberately not turned into a chunk. */
export interface ExcludedSection {
	/** The section's heading text, without its leading `#`s. */
	readonly heading: string;
	/** 1-indexed line number of the heading. */
	readonly line: number;
	/** How many task checkboxes the excluded section contained. */
	readonly taskCount: number;
	/** Why the section was excluded. */
	readonly reason: ExclusionReason;
}

/** The outcome of parsing a plan document with one source. */
export interface PlanParseResult {
	/** The chunks the document yielded. */
	readonly chunks: readonly PlanChunk[];
	/** Sections recognized but not emitted as chunks. */
	readonly excluded: readonly ExcludedSection[];
	/** Non-fatal problems, such as dependencies on undefined chunk ids. */
	readonly warnings: readonly string[];
}

/**
 * A plan dialect the registry can detect and parse.
 *
 * Implement this and call `registerPlanSource` to teach the tool a format it
 * does not ship with.
 */
export interface PlanSource {
	/** Lowercase kebab-case identifier, unique across the registry. */
	readonly name: string;
	/** Human-readable name for reports. */
	readonly displayName: string;

	/**
	 * Score how well this source understands the document.
	 *
	 * @param content - The raw plan document.
	 * @returns The confidence and the reason for it.
	 */
	detect(content: string): PlanSourceDetection;

	/**
	 * Parse the document into chunks.
	 *
	 * @param content - The raw plan document.
	 * @returns The chunks, plus anything excluded or warned about.
	 */
	parse(content: string): PlanParseResult;
}
