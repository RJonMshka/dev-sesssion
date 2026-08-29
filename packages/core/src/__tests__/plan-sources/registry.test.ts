import { ParseError } from "@dev-session/security";
import { afterEach, describe, expect, it } from "vitest";
import type { PlanSource } from "../../parsers/plan-sources/index.js";
import {
	detectPlanSource,
	getPlanSourceByName,
	getRegisteredPlanSources,
	parsePlan,
	registerPlanSource,
	unregisterPlanSource,
} from "../../parsers/plan-sources/index.js";

/** Requirements: docs/plan/LLD-plan-sources.md (area PS). */

const EMPTY_RESULT = { chunks: [], excluded: [], warnings: [] } as const;

function stubSource(name: string, confidence: number): PlanSource {
	return {
		name,
		displayName: name,
		detect: () => ({ confidence, reason: `stub ${name}` }),
		parse: () => ({
			...EMPTY_RESULT,
			chunks: [{ chunk_id: 1, title: name, depends_on: [], tasks: [] }],
		}),
	};
}

const registered: string[] = [];

function register(source: PlanSource): void {
	registerPlanSource(source);
	registered.push(source.name);
}

afterEach(() => {
	for (const name of registered.splice(0)) {
		unregisterPlanSource(name);
	}
});

describe("plan source registry — selection", () => {
	it("selects the source with the highest detection confidence (REQ-PS-1)", () => {
		register(stubSource("stub-high", 0.99));

		const { source } = parsePlan("## Chunk 1 — Auth\n- [ ] login\n");

		expect(source.name).toBe("stub-high");
	});

	it("ranks candidates by confidence, highest first (REQ-PS-1)", () => {
		register(stubSource("stub-mid", 0.5));

		const candidates = detectPlanSource("## Chunk 1 — Auth\n- [ ] login\n");
		const scores = candidates.map((c) => c.detection.confidence);

		expect(scores).toEqual([...scores].sort((a, b) => b - a));
	});

	it("breaks a confidence tie in favour of the earlier registration (REQ-PS-2)", () => {
		register(stubSource("stub-first", 0.42));
		register(stubSource("stub-second", 0.42));

		const candidates = detectPlanSource("plain text with no plan structure at all");
		const tied = candidates.filter((c) => c.detection.confidence === 0.42);

		expect(tied.map((c) => c.source.name)).toEqual(["stub-first", "stub-second"]);
	});

	it("reports every candidate and its score when none clears the threshold (REQ-PS-3)", () => {
		let thrown: unknown;
		try {
			parsePlan("Just a paragraph of prose. No headings, no tasks, nothing to parse.");
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(ParseError);
		const message = (thrown as ParseError).message;
		for (const source of getRegisteredPlanSources()) {
			expect(message).toContain(source.name);
		}
	});
});

describe("plan source registry — registration", () => {
	it("includes a registered custom source in detection (REQ-PS-16)", () => {
		register(stubSource("stub-custom", 0.7));

		expect(getPlanSourceByName("stub-custom")?.name).toBe("stub-custom");
		expect(detectPlanSource("## Chunk 1 — Auth\n").map((c) => c.source.name)).toContain(
			"stub-custom",
		);
	});

	it("rejects a name that is already registered (REQ-PS-17)", () => {
		register(stubSource("stub-dupe", 0.7));

		expect(() => registerPlanSource(stubSource("stub-dupe", 0.9))).toThrow();
	});

	it("rejects a name already used by a built-in source (REQ-PS-17)", () => {
		const builtin = getRegisteredPlanSources()[0];
		expect(builtin).toBeDefined();

		expect(() => registerPlanSource(stubSource(builtin?.name ?? "headings", 0.9))).toThrow();
	});
});
