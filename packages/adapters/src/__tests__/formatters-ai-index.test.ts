/**
 * Unit tests for `formatAiIndex` across all bootstrap formatters.
 *
 * Exercises every layer (0 = symbol names, 1 = signatures, 2 = full source)
 * plus the empty-index short-circuit, which the per-formatter suites did not
 * cover.
 */

import type { AiIndex } from "@dev-session/core";
import { describe, expect, it } from "vitest";
import { ClaudeBootstrapFormatter } from "../claude-bootstrap-formatter.js";
import { CursorBootstrapFormatter } from "../cursor-bootstrap-formatter.js";
import { OpencodeBootstrapFormatter } from "../opencode-bootstrap-formatter.js";
import { WindsurfBootstrapFormatter } from "../windsurf-bootstrap-formatter.js";

const formatters = [
	["claude", ClaudeBootstrapFormatter],
	["cursor", CursorBootstrapFormatter],
	["opencode", OpencodeBootstrapFormatter],
	["windsurf", WindsurfBootstrapFormatter],
] as const;

function makeIndex(): AiIndex {
	return {
		version: "2",
		generated_at: "2026-06-17T00:00:00Z",
		project_root: "/project",
		files: {
			"packages/core/src/utils.ts": {
				module_summary: "Core utilities.",
				layer_default: 0,
				token_cost: 120,
				token_cost_accurate: false,
				exports: {
					doThing: {
						surface: "public",
						summary: "Does the thing.",
						signature: "export function doThing(x: number): number",
						line: 10,
						tags: ["util"],
					},
				},
			},
		},
	};
}

const emptyIndex: AiIndex = {
	version: "2",
	generated_at: "2026-06-17T00:00:00Z",
	project_root: "/project",
	files: {},
};

describe("formatAiIndex across formatters", () => {
	for (const [name, formatter] of formatters) {
		describe(name, () => {
			it("returns '' for an empty index", () => {
				expect(formatter.formatAiIndex(emptyIndex, 0)).toBe("");
			});

			it.each([0, 1, 2] as const)("renders a string for layer %i", (layer) => {
				const out = formatter.formatAiIndex(makeIndex(), layer);
				expect(typeof out).toBe("string");
				expect(out.length).toBeGreaterThan(0);
			});

			it("references the indexed file at layer 0", () => {
				const out = formatter.formatAiIndex(makeIndex(), 0);
				expect(out).toContain("utils.ts");
			});
		});
	}
});
