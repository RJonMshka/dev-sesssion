/**
 * Arm-mapping and order-stability coverage for the pairwise judge.
 *
 * Requirements: docs/plan/LLD-eval-harness.md (area EVAL).
 *
 * This is the highest-stakes test in the harness. `compareArms` calls the
 * comparator twice with the candidates swapped, and maps each positional verdict
 * back to the arm that occupied that position. Invert that mapping and every
 * verdict in every published report reverses — while the order-stability check
 * still passes, because both orderings invert together. Nothing else in the
 * repository would notice.
 *
 * The comparator is injected, so these run with no API key and no network.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import {
	type Candidate,
	type Comparator,
	compareArms,
	type PositionalVerdict,
} from "../checks/judge.js";

/** A candidate with no supporting files — content is irrelevant to the mapping. */
const candidate = (arm: "bootstrap" | "control"): Candidate => ({
	arm,
	content: `// ${arm}`,
	supportingFiles: new Map(),
});

const BOOTSTRAP = candidate("bootstrap");
const CONTROL = candidate("control");

/** Builds a comparator that always names the same position, ignoring inputs. */
const alwaysPicks = (winner: PositionalVerdict["winner"]): Comparator => {
	return () => Promise.resolve({ winner, margin: "clear", justification: "stub" });
};

/**
 * Builds a comparator that answers per ordering, keyed by which arm went first.
 *
 * @param byFirstArm - Verdict to return when that arm is in the first position.
 * @returns The comparator.
 */
const perOrdering = (byFirstArm: {
	bootstrap: PositionalVerdict["winner"];
	control: PositionalVerdict["winner"];
}): Comparator => {
	return (_dim, _grounding, first) =>
		Promise.resolve({
			winner: byFirstArm[first.arm],
			margin: "slight",
			justification: "stub",
		});
};

const grounding = {
	contract: "irrelevant",
	reference: "irrelevant",
	projectFiles: ["src/a.ts"] as readonly string[],
};

describe("pairwise arm mapping", () => {
	it("maps a first-position win to whichever arm was shown first (REQ-EVAL-1)", async () => {
		// The comparator always says "first". compareArms runs both orderings, so
		// ordering AB credits bootstrap and ordering BA credits control — the two
		// disagree, which is exactly what position bias looks like.
		const verdicts = await compareArms({
			...grounding,
			bootstrap: BOOTSTRAP,
			control: CONTROL,
			compare: alwaysPicks("first"),
		});

		for (const v of verdicts) {
			expect(v.raw).toEqual(["bootstrap", "control"]);
		}
	});

	it("maps a second-position win to whichever arm was shown second (REQ-EVAL-1)", async () => {
		const verdicts = await compareArms({
			...grounding,
			bootstrap: BOOTSTRAP,
			control: CONTROL,
			compare: alwaysPicks("second"),
		});

		for (const v of verdicts) {
			expect(v.raw).toEqual(["control", "bootstrap"]);
		}
	});

	it("credits the arm that wins in both orderings (REQ-EVAL-1)", async () => {
		// bootstrap first → "first" wins → bootstrap.
		// control first  → "second" wins → bootstrap.
		const verdicts = await compareArms({
			...grounding,
			bootstrap: BOOTSTRAP,
			control: CONTROL,
			compare: perOrdering({ bootstrap: "first", control: "second" }),
		});

		for (const v of verdicts) {
			expect(v.winner).toBe("bootstrap");
			expect(v.orderStable).toBe(true);
		}
	});

	it("credits control when control wins in both orderings (REQ-EVAL-1)", async () => {
		const verdicts = await compareArms({
			...grounding,
			bootstrap: BOOTSTRAP,
			control: CONTROL,
			compare: perOrdering({ bootstrap: "second", control: "first" }),
		});

		for (const v of verdicts) {
			expect(v.winner).toBe("control");
		}
	});
});

describe("order stability", () => {
	it("reports a verdict that flips with order as unstable, not a winner (REQ-EVAL-2)", async () => {
		const verdicts = await compareArms({
			...grounding,
			bootstrap: BOOTSTRAP,
			control: CONTROL,
			compare: alwaysPicks("first"),
		});

		for (const v of verdicts) {
			expect(v.orderStable).toBe(false);
			expect(v.winner).toBeNull();
			expect(v.margin).toBe("none");
		}
	});

	it("reports an agreed tie as stable with no winner (REQ-EVAL-2)", async () => {
		const verdicts = await compareArms({
			...grounding,
			bootstrap: BOOTSTRAP,
			control: CONTROL,
			compare: alwaysPicks("tie"),
		});

		for (const v of verdicts) {
			expect(v.orderStable).toBe(true);
			expect(v.winner).toBeNull();
		}
	});

	it("judges every rubric dimension (REQ-EVAL-2)", async () => {
		const verdicts = await compareArms({
			...grounding,
			bootstrap: BOOTSTRAP,
			control: CONTROL,
			compare: alwaysPicks("tie"),
		});

		expect(verdicts.map((v) => v.dimension)).toEqual([
			"contract_satisfaction",
			"convention_match",
			"no_fabrication",
		]);
	});
});
