/**
 * Property-based tests for PlanParser (fast-check).
 *
 * Complements the example-based suite with input-space invariants:
 *
 *   1. Round-trip — `fromMarkdown(toMarkdown(chunk))` preserves the chunk's
 *      id, title, tasks, dependencies, and est_sessions.
 *   2. Empty content always throws ParseError; non-empty content never throws.
 *   3. detectBoundaries only ever reports in-range lines, known confidence
 *      scores, and a 1..N consecutive suggestedChunkId sequence.
 */
import { ParseError } from "@dev-session/security";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PlanParser } from "../parsers/plan-parser.js";
import type { PlanChunk, Task } from "../schemas/index.js";
import { TaskStatus } from "../schemas/index.js";

/** Number of generated cases per property. */
const RUNS = 300;

/**
 * A text arbitrary safe for single-line markdown: non-empty after trimming,
 * with all control characters (newlines, tabs, CR, etc.) flattened to spaces.
 * This is the space of titles/task-text the parser is expected to round-trip.
 */
const safeLineText = fc
	.string({ minLength: 1, maxLength: 40 })
	.map((s) =>
		Array.from(s, (ch) => {
			const code = ch.charCodeAt(0);
			return code < 0x20 || code === 0x7f ? " " : ch;
		})
			.join("")
			.trim(),
	)
	.filter((s) => s.length > 0);

/** A single task with a round-trippable text and a valid status. */
const taskArb: fc.Arbitrary<Task> = fc.record({
	text: safeLineText,
	status: fc.constantFrom(TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE),
});

/** A plan chunk whose every field survives the markdown round-trip. */
const chunkArb: fc.Arbitrary<PlanChunk> = fc
	.record({
		chunk_id: fc.integer({ min: 1, max: 999 }),
		title: safeLineText,
		depends_on: fc.array(fc.integer({ min: 1, max: 99 }), { maxLength: 5 }),
		tasks: fc.array(taskArb, { maxLength: 8 }),
		est_sessions: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
	})
	.map(
		({ est_sessions, ...rest }): PlanChunk =>
			est_sessions === undefined ? rest : { ...rest, est_sessions },
	);

/** Whitespace-only content (empty after trim). */
const blankContent = fc
	.array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), { maxLength: 20 })
	.map((parts) => parts.join(""));

/** Arbitrary non-empty content (something survives trimming). */
const nonEmptyContent = fc
	.string({ minLength: 1, maxLength: 400 })
	.filter((s) => s.trim().length > 0);

describe("PlanParser — property-based tests", () => {
	describe("round-trip: fromMarkdown(toMarkdown(chunk))", () => {
		it("preserves chunk_id, title, tasks, dependencies, and est_sessions", () => {
			fc.assert(
				fc.property(chunkArb, (chunk) => {
					const markdown = PlanParser.toMarkdown(chunk);
					const parsed = PlanParser.fromMarkdown(markdown);

					expect(parsed).toHaveLength(1);
					const got = parsed[0];
					expect(got).toBeDefined();
					if (got === undefined) {
						return;
					}

					expect(got.chunk_id).toBe(chunk.chunk_id);
					expect(got.title).toBe(chunk.title);
					expect(got.depends_on).toEqual(chunk.depends_on);
					expect(got.est_sessions).toBe(chunk.est_sessions);
					expect(got.tasks.map((t) => ({ text: t.text, status: t.status }))).toEqual(
						chunk.tasks.map((t) => ({ text: t.text, status: t.status })),
					);
				}),
				{ numRuns: RUNS },
			);
		});
	});

	describe("empty vs non-empty content", () => {
		it("throws ParseError for any whitespace-only content (fromMarkdown)", () => {
			fc.assert(
				fc.property(blankContent, (content) => {
					expect(() => PlanParser.fromMarkdown(content)).toThrow(ParseError);
				}),
				{ numRuns: RUNS },
			);
		});

		it("throws ParseError for any whitespace-only content (detectBoundaries)", () => {
			fc.assert(
				fc.property(blankContent, (content) => {
					expect(() => PlanParser.detectBoundaries(content)).toThrow(ParseError);
				}),
				{ numRuns: RUNS },
			);
		});

		it("never throws for any non-empty content and returns an array", () => {
			fc.assert(
				fc.property(nonEmptyContent, (content) => {
					const chunks = PlanParser.fromMarkdown(content);
					expect(Array.isArray(chunks)).toBe(true);
					const boundaries = PlanParser.detectBoundaries(content);
					expect(Array.isArray(boundaries)).toBe(true);
				}),
				{ numRuns: RUNS },
			);
		});

		it("never reports more chunks than there are '## ' heading lines", () => {
			fc.assert(
				fc.property(nonEmptyContent, (content) => {
					const h2Count = content.split("\n").filter((l) => /^## \s*.+$/.test(l.trim())).length;
					expect(PlanParser.fromMarkdown(content).length).toBeLessThanOrEqual(h2Count);
				}),
				{ numRuns: RUNS },
			);
		});
	});

	describe("detectBoundaries invariants", () => {
		it("reports in-range lines, known confidences, and a 1..N consecutive id sequence", () => {
			fc.assert(
				fc.property(nonEmptyContent, (content) => {
					const lineCount = content.split("\n").length;
					const boundaries = PlanParser.detectBoundaries(content);

					boundaries.forEach((b, i) => {
						expect(b.lineNumber).toBeGreaterThanOrEqual(1);
						expect(b.lineNumber).toBeLessThanOrEqual(lineCount);
						expect([1.0, 0.7, 0.5, 0.3]).toContain(b.confidence);
						expect(b.suggestedChunkId).toBe(i + 1);
					});

					// Line numbers are strictly increasing (one boundary per line, in order).
					for (let i = 1; i < boundaries.length; i++) {
						const prev = boundaries[i - 1];
						const cur = boundaries[i];
						if (prev !== undefined && cur !== undefined) {
							expect(cur.lineNumber).toBeGreaterThan(prev.lineNumber);
						}
					}
				}),
				{ numRuns: RUNS },
			);
		});
	});
});
