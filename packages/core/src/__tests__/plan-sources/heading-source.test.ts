import { describe, expect, it } from "vitest";
import { HeadingPlanSource } from "../../parsers/plan-sources/heading-source.js";

/**
 * Requirements under test live in docs/plan/LLD-plan-sources.md (area PS).
 *
 * Inputs here are shaped like plans people actually write — the dialects
 * measured as yielding zero chunks against the shipped parser. Assertions are
 * against parser output only; nothing hand-transcribes what an emitter emits.
 */

const parse = (content: string) => HeadingPlanSource.parse(content);
const ids = (content: string) => parse(content).chunks.map((c) => c.chunk_id);
const titles = (content: string) => parse(content).chunks.map((c) => c.title);

describe("HeadingPlanSource — split depth", () => {
	it("splits on the depth with the most position-declaring headings (REQ-PS-4)", () => {
		// h2 declares twice, h3 declares once. h3 is more numerous overall,
		// which is exactly the trap "most frequent depth" falls into.
		const content = [
			"# Roadmap",
			"",
			"## Chunk 1 — Auth",
			"### 1. Sub-note",
			"- [ ] login",
			"### Tasks",
			"- [ ] logout",
			"",
			"## Chunk 2 — Billing",
			"### Tasks",
			"- [ ] stripe",
		].join("\n");

		expect(ids(content)).toEqual([1, 2]);
	});

	it("splits on the shallowest repeated depth when nothing declares a position (REQ-PS-5)", () => {
		const content = [
			"# Roadmap",
			"",
			"### Auth",
			"- [ ] login",
			"",
			"### Billing",
			"- [ ] stripe",
		].join("\n");

		expect(ids(content)).toEqual([1, 2]);
		expect(titles(content)).toEqual(["Auth", "Billing"]);
	});

	it("splits h1-per-section documents on h1 (REQ-PS-5)", () => {
		const content = ["# Auth", "- [ ] login", "", "# Billing", "- [ ] stripe"].join("\n");

		expect(ids(content)).toEqual([1, 2]);
		expect(titles(content)).toEqual(["Auth", "Billing"]);
	});

	it("ignores heading-like lines inside fenced code blocks (REQ-PS-18)", () => {
		const content = [
			"# Roadmap",
			"",
			"```yaml",
			"# .session/ai-index.yaml",
			"## Chunk 99 — not a heading",
			"```",
			"",
			"### Auth",
			"- [ ] login",
			"",
			"### Billing",
			"- [ ] stripe",
		].join("\n");

		// Without fence-skipping the census sees a declaring h2 and picks h2,
		// yielding a single bogus "Chunk 99" chunk.
		expect(ids(content)).toEqual([1, 2]);
		expect(titles(content)).toEqual(["Auth", "Billing"]);
	});
});

describe("HeadingPlanSource — section boundaries", () => {
	it("ends the current section at a shallower heading (REQ-PS-19)", () => {
		// h3 is the split depth. The h2 that follows is a parent heading, so it
		// closes "Billing" — its tasks belong to no chunk rather than being
		// silently appended to the preceding one.
		const content = [
			"# Roadmap",
			"",
			"### Auth",
			"- [ ] login",
			"",
			"### Billing",
			"- [ ] stripe",
			"",
			"## Notes",
			"- [ ] not part of Billing",
		].join("\n");

		const result = parse(content);

		expect(result.chunks.map((c) => c.title)).toEqual(["Auth", "Billing"]);
		expect(result.chunks[1]?.tasks.map((t) => t.text)).toEqual(["stripe"]);
	});

	it("reports a shallower section that carries tasks (REQ-PS-19)", () => {
		const content = [
			"# Roadmap",
			"",
			"### Auth",
			"- [ ] login",
			"",
			"### Billing",
			"- [ ] stripe",
			"",
			"## Notes",
			"- [ ] not part of Billing",
		].join("\n");

		const excluded = parse(content).excluded;

		expect(excluded.map((e) => e.heading)).toContain("Notes");
		expect(excluded.find((e) => e.heading === "Notes")?.taskCount).toBe(1);
	});

	it("does not report a parent heading that carries no tasks (REQ-PS-19)", () => {
		// "# Roadmap" is a document title, not lost work.
		const content = [
			"# Roadmap",
			"",
			"### Auth",
			"- [ ] login",
			"",
			"### Billing",
			"- [ ] stripe",
		].join("\n");

		expect(parse(content).excluded).toEqual([]);
	});

	it("keeps deeper headings inside their section (REQ-PS-19)", () => {
		const content = [
			"## Chunk 1 — Auth",
			"### Tasks",
			"- [ ] login",
			"#### Details",
			"- [ ] logout",
		].join("\n");

		expect(parse(content).chunks[0]?.tasks).toHaveLength(2);
	});
});

describe("HeadingPlanSource — chunk ids", () => {
	it("uses the number a heading declares, not its ordinal position (REQ-PS-6)", () => {
		const content = [
			"## Phase 3 — Auth",
			"- [ ] login",
			"",
			"## Phase 7 — Billing",
			"- [ ] stripe",
		].join("\n");

		expect(ids(content)).toEqual([3, 7]);
	});

	it("reads a declared position from a bare leading number (REQ-PS-6)", () => {
		const content = ["## 4. Auth", "- [ ] login", "", "## 5. Billing", "- [ ] stripe"].join("\n");

		expect(ids(content)).toEqual([4, 5]);
	});

	it("preserves fractional declared ids (REQ-PS-6)", () => {
		const content = [
			"## Chunk 3 — Auth",
			"- [ ] a",
			"",
			"## Chunk 3.5 — Interstitial",
			"- [ ] b",
		].join("\n");

		expect(ids(content)).toEqual([3, 3.5]);
	});

	it("assigns ordinal ids when no heading declares a position (REQ-PS-7)", () => {
		const content = ["## Auth", "- [ ] login", "", "## Billing", "- [ ] stripe"].join("\n");

		expect(ids(content)).toEqual([1, 2]);
	});

	it("gives alphanumeric headings distinct ordinal ids (REQ-PS-7)", () => {
		// The old chunk-id regex had no trailing boundary, so "Chunk 13a" and
		// "Chunk 13b" both read as 13. split-plan writes PLAN_<id>.md, so the
		// second silently overwrote the first.
		const content = [
			"## Chunk 13a — Auth",
			"- [ ] login",
			"",
			"## Chunk 13b — Billing",
			"- [ ] stripe",
		].join("\n");

		const parsed = ids(content);

		expect(new Set(parsed).size).toBe(parsed.length);
		expect(parsed).toEqual([1, 2]);
	});

	it("excludes a declared id the chunk schema cannot represent (REQ-PS-8)", () => {
		const content = [
			"## Chunk 0 — Setup",
			"- [ ] init",
			"",
			"## Chunk 1 — Auth",
			"- [ ] login",
		].join("\n");

		const result = parse(content);

		expect(result.chunks.map((c) => c.chunk_id)).toEqual([1]);
		expect(result.excluded).toHaveLength(1);
		expect(result.excluded[0]?.heading).toContain("Chunk 0");
		expect(result.excluded[0]?.reason).toBe("unrepresentable-id");
	});

	it("excludes chunk 0 identically whether or not a sibling matches (REQ-PS-8)", () => {
		// The shipped parser renumbers this to chunk 1 when alone, and deletes it
		// when a `## Chunk 1` sibling exists. One heading, two meanings.
		const alone = parse(["## Chunk 0 — Setup", "- [ ] init"].join("\n"));

		expect(alone.chunks).toHaveLength(0);
		expect(alone.excluded.map((e) => e.reason)).toEqual(["unrepresentable-id"]);
	});
});

describe("HeadingPlanSource — exclusions", () => {
	it("excludes non-declaring sections when the document declares positions (REQ-PS-9)", () => {
		const content = [
			"## Chunk 1 — Auth",
			"- [ ] login",
			"",
			"## Overview",
			"Some prose, no tasks.",
			"",
			"## Chunk 2 — Billing",
			"- [ ] stripe",
		].join("\n");

		const result = parse(content);

		expect(result.chunks.map((c) => c.chunk_id)).toEqual([1, 2]);
		expect(result.excluded.map((e) => e.heading)).toEqual(["Overview"]);
	});

	it("reports each excluded section with heading, line, and task count (REQ-PS-10)", () => {
		const content = [
			"## Chunk 1 — Auth", // line 1
			"- [ ] login",
			"",
			"## Notes", // line 4
			"- [ ] this task is dropped today with no diagnostic",
			"- [ ] and so is this one",
		].join("\n");

		const result = parse(content);

		expect(result.excluded).toHaveLength(1);
		expect(result.excluded[0]).toMatchObject({
			heading: "Notes",
			line: 4,
			taskCount: 2,
			reason: "no-position-declared",
		});
	});

	it("reports no exclusions when every section declares a position (REQ-PS-10)", () => {
		const content = [
			"## Chunk 1 — Auth",
			"- [ ] login",
			"",
			"## Chunk 2 — Billing",
			"- [ ] stripe",
		].join("\n");

		expect(parse(content).excluded).toEqual([]);
	});
});

describe("HeadingPlanSource — dependencies", () => {
	it("recognizes a dependency naming the document's own position noun (REQ-PS-12)", () => {
		const content = [
			"## Phase 3 — Auth",
			"- [ ] login",
			"",
			"## Phase 4 — Billing",
			"> Depends on: Phase 3",
			"- [ ] stripe",
		].join("\n");

		const billing = parse(content).chunks.find((c) => c.chunk_id === 4);

		expect(billing?.depends_on).toEqual([3]);
	});

	it("still recognizes the Chunk noun (REQ-PS-12)", () => {
		const content = [
			"## Chunk 1 — Auth",
			"- [ ] login",
			"",
			"## Chunk 2 — Billing",
			"> Depends on: Chunk 1",
			"- [ ] stripe",
		].join("\n");

		expect(parse(content).chunks[1]?.depends_on).toEqual([1]);
	});

	it("reports but preserves a dependency the document does not define (REQ-PS-13)", () => {
		// Preserved because a plan split across PLAN_N.md files depends on chunks
		// that live in sibling documents; the parser cannot tell that from a typo.
		const content = [
			"## Phase 3 — Auth",
			"- [ ] login",
			"",
			"## Phase 5 — Deploy",
			"> Depends on: Phase 4",
			"- [ ] ship",
		].join("\n");

		const result = parse(content);

		expect(result.chunks.find((c) => c.chunk_id === 5)?.depends_on).toEqual([4]);
		expect(result.warnings.join(" ")).toContain("4");
	});

	it("keeps dependencies that resolve to a defined chunk (REQ-PS-13)", () => {
		const content = [
			"## Phase 3 — Auth",
			"- [ ] login",
			"",
			"## Phase 5 — Deploy",
			"> Depends on: Phase 3",
			"- [ ] ship",
		].join("\n");

		const result = parse(content);

		expect(result.chunks.find((c) => c.chunk_id === 5)?.depends_on).toEqual([3]);
		expect(result.warnings).toEqual([]);
	});
});

describe("HeadingPlanSource — detection", () => {
	it("scores a position-declaring document highest", () => {
		const declaring = HeadingPlanSource.detect("## Chunk 1 — Auth\n- [ ] a\n");
		const plain = HeadingPlanSource.detect("## Auth\n- [ ] a\n\n## Billing\n- [ ] b\n");

		expect(declaring.confidence).toBeGreaterThan(plain.confidence);
		expect(plain.confidence).toBeGreaterThan(0);
	});

	it("scores a document with no headings at zero", () => {
		expect(HeadingPlanSource.detect("- [ ] login\n- [ ] stripe\n").confidence).toBe(0);
	});
});
