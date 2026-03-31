/**
 * A detected boundary in a PLAN.md file where it could be split into chunks.
 */
export interface BoundaryResult {
	/** The line number where the boundary starts (1-indexed). */
	readonly lineNumber: number;
	/** The heading text at this boundary. */
	readonly heading: string;
	/** Confidence score between 0 and 1 that this is a valid chunk boundary. */
	readonly confidence: number;
	/** The suggested chunk ID if this boundary is used. */
	readonly suggestedChunkId: number;
}
