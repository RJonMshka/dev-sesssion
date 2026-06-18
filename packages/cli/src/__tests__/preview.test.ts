import { describe, expect, it } from "vitest";
import type { TokenBreakdownEntry } from "../commands/preview.js";
import { renderBreakdownTable } from "../commands/preview.js";

describe("renderBreakdownTable", () => {
	const breakdown: TokenBreakdownEntry[] = [
		{ label: "SESSION_STATE.md", tokens: 245, percent: 12 },
		{ label: "Active plan chunk", tokens: 180, percent: 9 },
		{
			label: "Always-include files (2)",
			tokens: 320,
			percent: 16,
			files: [
				{ path: "CLAUDE.md", tokens: 200, fullTokens: 200, layer: 1, escalated: false },
				{ path: ".session/ROUTINES.md", tokens: 120, fullTokens: 120, layer: 1, escalated: false },
			],
		},
		{
			label: "Context files (1)",
			tokens: 580,
			percent: 29,
			files: [
				{
					path: "packages/core/src/index.ts",
					tokens: 580,
					fullTokens: 580,
					layer: 2,
					escalated: true,
				},
			],
		},
	];
	const total = 1325;
	const cap = 4000;

	it("includes a TOTAL line", () => {
		const table = renderBreakdownTable(breakdown, total, cap, false, false);
		expect(table).toContain("TOTAL");
		expect(table).toContain(String(total));
	});

	it("includes the budget cap", () => {
		const table = renderBreakdownTable(breakdown, total, cap, false, false);
		expect(table).toContain(String(cap));
	});

	it("shows [OK] when within budget", () => {
		const table = renderBreakdownTable(breakdown, total, cap, false, false);
		expect(table).toContain("[OK]");
		expect(table).not.toContain("[OVER BUDGET]");
	});

	it("shows [OVER BUDGET] when over budget", () => {
		const table = renderBreakdownTable(breakdown, total, cap, true, false);
		expect(table).toContain("[OVER BUDGET]");
	});

	it("includes heuristic prefix when not accurate", () => {
		const table = renderBreakdownTable(breakdown, total, cap, false, false);
		expect(table).toContain("~");
	});

	it("omits heuristic prefix when accurate", () => {
		const table = renderBreakdownTable(breakdown, total, cap, false, true);
		expect(table).not.toContain("~");
	});

	it("includes component labels", () => {
		const table = renderBreakdownTable(breakdown, total, cap, false, false);
		expect(table).toContain("SESSION_STATE.md");
		expect(table).toContain("Active plan chunk");
	});

	it("includes nested file paths", () => {
		const table = renderBreakdownTable(breakdown, total, cap, false, false);
		expect(table).toContain("CLAUDE.md");
		expect(table).toContain(".session/ROUTINES.md");
	});

	it("truncates very long file paths with ellipsis", () => {
		const longPath = "packages/very/deeply/nested/path/to/a/file/with/an/extremely/long/name.ts";
		const breakdownWithLong: TokenBreakdownEntry[] = [
			{
				label: "Context files (1)",
				tokens: 100,
				percent: 100,
				files: [{ path: longPath, tokens: 100, fullTokens: 100, layer: 2, escalated: true }],
			},
		];
		const table = renderBreakdownTable(breakdownWithLong, 100, 4000, false, false);
		expect(table).toContain("…");
	});

	it("renders per-file layer markers with an escalation asterisk", () => {
		const table = renderBreakdownTable(breakdown, total, cap, false, false);
		// Always-include files resolved at layer 1, not escalated.
		expect(table).toContain("L1");
		// Context file escalated to full source -> "L2*".
		expect(table).toContain("L2*");
	});

	it("shows the escalation delta for reduced-layer files", () => {
		const breakdownWithDelta: TokenBreakdownEntry[] = [
			{
				label: "Context files (1)",
				tokens: 40,
				percent: 100,
				files: [{ path: "src/a.ts", tokens: 40, fullTokens: 500, layer: 0, escalated: false }],
			},
		];
		const table = renderBreakdownTable(breakdownWithDelta, 40, 4000, false, false);
		expect(table).toContain("(+460 full)");
	});

	it("omits the layer marker when layer is null (no ai-index)", () => {
		const breakdownNoIndex: TokenBreakdownEntry[] = [
			{
				label: "Context files (1)",
				tokens: 500,
				percent: 100,
				files: [{ path: "src/a.ts", tokens: 500, fullTokens: 500, layer: null, escalated: false }],
			},
		];
		const table = renderBreakdownTable(breakdownNoIndex, 500, 4000, false, false);
		expect(table).not.toContain("Lundefined");
		expect(table).not.toContain("L0");
	});

	it("handles zero total tokens without dividing by zero", () => {
		const emptyBreakdown: TokenBreakdownEntry[] = [{ label: "Empty", tokens: 0, percent: 0 }];
		expect(() => renderBreakdownTable(emptyBreakdown, 0, 4000, false, false)).not.toThrow();
	});
});
