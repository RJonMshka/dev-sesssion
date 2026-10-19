/**
 * The units eval's own parsing and arithmetic (LLD-code-units.md, REQ-UNIT-26..28).
 *
 * The harness never imports `packages/`, so it re-implements the PROTOCOL.md
 * contracts — the ai-index unit rows, the hash, the Focus line — from the spec.
 * These tests pin that re-implementation; `pnpm eval:units` then checks it
 * against what the real CLI writes.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { declaredFromPrompt } from "../checks/grounding.js";
import {
	checkFocusGrounding,
	checkHashFidelity,
	parseFocusRefs,
	parseIndexUnits,
	protocolHash,
	summarizeReduction,
} from "../checks/units.js";

const INDEX = `files:
  "src/a.ts":
    exports: {}
    hash: "0f0f0f0f0f0f0f0f"
    units:
      "Store.add":
        end: 3
        exported: true
        hash: "${protocolHash("line1\nline2\nline3", 1, 3)}"
        kind: method
        start: 1
        tokens: 4
      parse:
        end: 2
        exported: false
        hash: deadbeefdeadbeef
        kind: function
        start: 2
        tokens: 2
  src/b.ts:
    exports: {}
version: "2"
`;

describe("protocolHash", () => {
	it("hashes lines start..end joined by newline, first 16 hex (REQ-UNIT-26)", () => {
		const expected = createHash("sha256").update("b\nc", "utf8").digest("hex").slice(0, 16);
		expect(protocolHash("a\nb\nc\nd", 2, 3)).toBe(expected);
	});
});

describe("parseIndexUnits", () => {
	it("reads every unit row with its file, quoted or bare keys (REQ-UNIT-26)", () => {
		const rows = parseIndexUnits(INDEX);
		expect(rows).toEqual([
			{
				path: "src/a.ts",
				id: "Store.add",
				start: 1,
				end: 3,
				hash: expect.any(String),
				tokens: 4,
				exported: true,
				kind: "method",
			},
			{
				path: "src/a.ts",
				id: "parse",
				start: 2,
				end: 2,
				hash: "deadbeefdeadbeef",
				tokens: 2,
				exported: false,
				kind: "function",
			},
		]);
	});
});

describe("checkHashFidelity", () => {
	it("passes a matching unit and reports a mismatched one (REQ-UNIT-26)", () => {
		const rows = parseIndexUnits(INDEX);
		const result = checkHashFidelity(rows, () => "line1\nline2\nline3");
		expect(result.checked).toBe(2);
		expect(result.mismatches).toEqual(["src/a.ts#parse"]);
	});

	it("reports a unit whose file cannot be read (REQ-UNIT-26)", () => {
		const result = checkHashFidelity(parseIndexUnits(INDEX), () => null);
		expect(result.mismatches).toHaveLength(2);
	});
});

describe("Focus refs", () => {
	const prompt =
		"Project: p\nFocus (read_unit): src/a.ts#Store.add:1-3, src/b.ts#x~2:4-9, +2 more\nLoad full: src/c.ts\n";

	it("parses path, id and range, skipping the truncation marker (REQ-UNIT-27)", () => {
		expect(parseFocusRefs(prompt)).toEqual([
			{ path: "src/a.ts", id: "Store.add", start: 1, end: 3 },
			{ path: "src/b.ts", id: "x~2", start: 4, end: 9 },
		]);
	});

	it("grounds a ref only against a unit with the same range (REQ-UNIT-27)", () => {
		const rows = parseIndexUnits(INDEX);
		expect(checkFocusGrounding(parseFocusRefs(prompt), rows)).toEqual(["src/b.ts#x~2:4-9"]);
		const shifted = "Focus (read_unit): src/a.ts#Store.add:2-4\n";
		expect(checkFocusGrounding(parseFocusRefs(shifted), rows)).toEqual(["src/a.ts#Store.add:2-4"]);
	});

	it("is read by the path-grounding check as the unit's file (REQ-UNIT-27)", () => {
		expect(declaredFromPrompt(prompt)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
	});
});

describe("summarizeReduction", () => {
	it("compares each focused unit with its whole file (REQ-UNIT-28)", () => {
		const s = summarizeReduction({
			totals: { tokens: 150, file_tokens: 1200 },
			entries: [
				{ ref: "a.ts#f", granularity: "unit", tokens: 50, file_tokens: 1000 },
				{ ref: "b.ts#g", granularity: "unit", tokens: 20, file_tokens: 100 },
				{ ref: "c.ts", granularity: "signature", tokens: 80, file_tokens: 200 },
			],
		});
		expect(s.unitTokens).toBe(70);
		expect(s.unitFileTokens).toBe(1100);
		expect(s.unitRatio).toBeCloseTo(70 / 1100);
		expect(s.manifestRatio).toBeCloseTo(150 / 1200);
	});

	it("reports no unit ratio when nothing was focused (REQ-UNIT-28)", () => {
		const s = summarizeReduction({ totals: { tokens: 0, file_tokens: 0 }, entries: [] });
		expect(s.unitRatio).toBeNull();
		expect(s.manifestRatio).toBeNull();
	});
});
