import { ParseError } from "@dev-session/security";
import { describe, expect, it } from "vitest";
import { PlanParser } from "../parsers/plan-parser.js";

const SAMPLE_PLAN = `# My Project Plan

## Chunk 1 — Foundation

> Depends on: nothing
> Est. sessions: 2

### Tasks

- [x] Set up monorepo
- [ ] Configure linting
- [-] Write CI pipeline

## Chunk 2 — Security utilities

> Depends on: Chunk 1
> Est. sessions: 3

- [ ] PathValidator
- [x] SecretScanner

## Chunk 3 — Core data model

> Depends on: Chunks 1, 2
> Est. sessions: 3

- [ ] Build schemas
- [ ] Build managers
`;

describe("PlanParser", () => {
	describe("fromMarkdown", () => {
		it("splits on ## headings and extracts chunks", () => {
			const chunks = PlanParser.fromMarkdown(SAMPLE_PLAN);

			expect(chunks).toHaveLength(3);
			expect(chunks[0]?.chunk_id).toBe(1);
			expect(chunks[1]?.chunk_id).toBe(2);
			expect(chunks[2]?.chunk_id).toBe(3);
		});

		it("extracts titles correctly", () => {
			const chunks = PlanParser.fromMarkdown(SAMPLE_PLAN);

			expect(chunks[0]?.title).toBe("Foundation");
			expect(chunks[1]?.title).toBe("Security utilities");
			expect(chunks[2]?.title).toBe("Core data model");
		});

		it("extracts tasks with correct statuses", () => {
			const chunks = PlanParser.fromMarkdown(SAMPLE_PLAN);
			const c1Tasks = chunks[0]?.tasks ?? [];

			expect(c1Tasks).toHaveLength(3);
			expect(c1Tasks[0]?.status).toBe("done");
			expect(c1Tasks[0]?.text).toBe("Set up monorepo");
			expect(c1Tasks[1]?.status).toBe("todo");
			expect(c1Tasks[2]?.status).toBe("in-progress");
		});

		it("extracts dependencies", () => {
			const chunks = PlanParser.fromMarkdown(SAMPLE_PLAN);

			expect(chunks[1]?.depends_on).toEqual([1]);
			expect(chunks[2]?.depends_on).toEqual([1, 2]);
		});

		it("extracts estimated sessions", () => {
			const chunks = PlanParser.fromMarkdown(SAMPLE_PLAN);

			expect(chunks[0]?.est_sessions).toBe(2);
			expect(chunks[1]?.est_sessions).toBe(3);
		});

		it("ignores content before first ## heading", () => {
			const plan = "# Title\n\nSome intro text.\n\n## Chunk 1 — First\n\n- [ ] Task A\n";
			const chunks = PlanParser.fromMarkdown(plan);

			expect(chunks).toHaveLength(1);
			expect(chunks[0]?.title).toBe("First");
		});

		it("handles headings without 'Chunk N' pattern (sequential IDs)", () => {
			const plan = "## Introduction\n\n- [ ] A\n\n## Implementation\n\n- [ ] B\n";
			const chunks = PlanParser.fromMarkdown(plan);

			expect(chunks).toHaveLength(2);
			expect(chunks[0]?.chunk_id).toBe(1);
			expect(chunks[1]?.chunk_id).toBe(2);
		});

		it("handles empty sections", () => {
			const plan = "## Chunk 1 — Empty\n\n## Chunk 2 — Also empty\n";
			const chunks = PlanParser.fromMarkdown(plan);

			expect(chunks).toHaveLength(2);
			expect(chunks[0]?.tasks).toEqual([]);
			expect(chunks[1]?.tasks).toEqual([]);
		});

		it("throws ParseError for empty content", () => {
			expect(() => PlanParser.fromMarkdown("")).toThrow(ParseError);
			expect(() => PlanParser.fromMarkdown("   ")).toThrow(ParseError);
		});
	});

	describe("detectBoundaries", () => {
		it("detects ## headings with confidence 1.0", () => {
			const boundaries = PlanParser.detectBoundaries(SAMPLE_PLAN);
			const h2s = boundaries.filter((b) => b.confidence === 1.0);

			expect(h2s.length).toBe(3);
		});

		it("detects ### headings with confidence 0.3", () => {
			const boundaries = PlanParser.detectBoundaries(SAMPLE_PLAN);
			const h3s = boundaries.filter((b) => b.confidence === 0.3);

			expect(h3s.length).toBeGreaterThanOrEqual(1);
		});

		it("detects # heading with confidence 0.7", () => {
			const boundaries = PlanParser.detectBoundaries(SAMPLE_PLAN);
			const h1s = boundaries.filter((b) => b.confidence === 0.7);

			expect(h1s.length).toBe(1);
		});

		it("assigns sequential suggestedChunkIds", () => {
			const boundaries = PlanParser.detectBoundaries(SAMPLE_PLAN);

			for (let i = 0; i < boundaries.length; i++) {
				expect(boundaries[i]?.suggestedChunkId).toBe(i + 1);
			}
		});

		it("throws ParseError for empty content", () => {
			expect(() => PlanParser.detectBoundaries("")).toThrow(ParseError);
		});

		it("skips frontmatter delimiters", () => {
			const content = "---\ntitle: test\n---\n\n## Section 1\n\nContent.\n";
			const boundaries = PlanParser.detectBoundaries(content);
			// The --- in frontmatter should not be counted as HR boundaries
			const hrs = boundaries.filter((b) => b.confidence === 0.5);
			expect(hrs).toHaveLength(0);
		});
	});

	describe("toMarkdown", () => {
		it("serializes a chunk to markdown", () => {
			const chunk = {
				chunk_id: 2,
				title: "Security",
				depends_on: [1],
				est_sessions: 3,
				tasks: [
					{ text: "PathValidator", status: "done" as const },
					{ text: "SecretScanner", status: "todo" as const },
					{ text: "WriteGuard", status: "in-progress" as const },
				],
			};

			const md = PlanParser.toMarkdown(chunk);

			expect(md).toContain("## Chunk 2 — Security");
			expect(md).toContain("Depends on: Chunk 1");
			expect(md).toContain("Est. sessions: 3");
			expect(md).toContain("- [x] PathValidator");
			expect(md).toContain("- [ ] SecretScanner");
			expect(md).toContain("- [-] WriteGuard");
		});

		it("omits dependency line if no dependencies", () => {
			const chunk = {
				chunk_id: 1,
				title: "First",
				depends_on: [],
				tasks: [],
			};

			const md = PlanParser.toMarkdown(chunk);
			expect(md).not.toContain("Depends on:");
		});

		it("uses 'Chunks' for multiple dependencies", () => {
			const chunk = {
				chunk_id: 3,
				title: "Third",
				depends_on: [1, 2],
				tasks: [],
			};

			const md = PlanParser.toMarkdown(chunk);
			expect(md).toContain("Depends on: Chunks 1, 2");
		});
	});
});
