/**
 * Paths a plan section names outside its task lines (LLD-file-index.md,
 * REQ-IDX-12..15).
 *
 * The Key Files shape is DevNexus's, where 2.4.2 tagged 0 of 47 named files
 * that exist: a fenced list, brace groups, a glob, and a directory.
 */

import { describe, expect, it } from "vitest";
import { extractFileRefs } from "../../parsers/plan-sources/file-refs.js";
import { scanLines } from "../../parsers/plan-sources/markdown-utils.js";

const refs = (...lines: string[]): string[] => extractFileRefs(scanLines(lines.join("\n")));

describe("extractFileRefs", () => {
	it("records every path in a fenced block (REQ-IDX-12)", () => {
		expect(
			refs(
				"### Key Files",
				"```",
				"apps/shell/src/App.tsx",
				"turbo.json",
				"pnpm-workspace.yaml",
				"```",
			),
		).toEqual(["apps/shell/src/App.tsx", "turbo.json", "pnpm-workspace.yaml"]);
	});

	it("records a backticked path and a bare path containing a slash (REQ-IDX-12)", () => {
		expect(
			refs(
				"1. Draft `docs/architecture.md` with the ADRs",
				"3. `tsconfig.base.json` with strict mode",
				"Then wire src/main.ts, as before.",
			),
		).toEqual(["docs/architecture.md", "tsconfig.base.json", "src/main.ts"]);
	});

	it("does not record bare prose words, version numbers or directories (REQ-IDX-12)", () => {
		expect(
			refs(
				"Uses Node.js and Vue.js, e.g. MF 2.0 runtime.",
				"Lives under `apps/shell/` and apps/mfe-api/src/app/components/request-builder/",
				"Build/dev/test/lint pipelines",
			),
		).toEqual([]);
	});

	it("does not record a path named only in a checkbox task (REQ-IDX-12)", () => {
		// Tasks carry their own status; a done task must not tag through `files`.
		expect(
			refs("- [x] Wrote `src/done.ts`", "- [ ] Edit `src/todo.ts`", "See `src/prose.ts`"),
		).toEqual(["src/prose.ts"]);
	});

	it("expands a brace group into each alternative (REQ-IDX-13)", () => {
		expect(refs("```", "apps/shell/src/layout/{Sidebar,Header,ContentArea}.tsx", "```")).toEqual([
			"apps/shell/src/layout/Sidebar.tsx",
			"apps/shell/src/layout/Header.tsx",
			"apps/shell/src/layout/ContentArea.tsx",
		]);
	});

	it("caps brace expansion so repo text cannot multiply without bound (REQ-IDX-13)", () => {
		const bomb = `\`${"{a,b}".repeat(10)}.ts\``; // 1024 expansions
		expect(refs(bomb).length).toBeLessThanOrEqual(64);
	});

	it("does not record a glob (REQ-IDX-14)", () => {
		expect(refs("```", "packages/shared/__tests__/*.test.ts", "src/?.ts", "```")).toEqual([]);
	});

	it("records each path once, at its first position (REQ-IDX-15)", () => {
		expect(refs("`b.ts` and `a/c.ts`", "```", "a/c.ts", "b.ts", "d.ts", "```")).toEqual([
			"b.ts",
			"a/c.ts",
			"d.ts",
		]);
	});

	it("rejects paths that escape the repository (REQ-IDX-12)", () => {
		expect(refs("`../secrets/key.pem`", "`/etc/passwd.txt`", "`./src/ok.ts`")).toEqual([
			"src/ok.ts",
		]);
	});
});
