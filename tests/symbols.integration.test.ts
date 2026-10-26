/**
 * `symbols` over this repository's own core source (LLD-symbols.md, REQ-SYM-1..4).
 *
 * The unit tests use tidy synthetic files. This indexes a temp copy of
 * `packages/core/src` with the real builder, where `trimToMaxLines` is
 * declared twice, and checks the answer against the resolver the prompt uses.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../packages/core/src/annotation/ai-index-builder.js";
import { SymbolQuery } from "../packages/core/src/annotation/symbol-query.js";
import type { AiIndex } from "../packages/core/src/annotation/types.js";
import { LayerResolver } from "../packages/core/src/calculators/layer-resolver.js";
import { UnitFocusResolver } from "../packages/core/src/calculators/unit-focus.js";
import {
	PathValidator,
	type ValidatedPath,
} from "../packages/security/src/validators/path-validator.js";

const CORE_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packages/core/src");

let tmp: string;
let root: ValidatedPath;
let index: AiIndex;

beforeAll(async () => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "symbols-core-"));
	fs.cpSync(CORE_SRC, path.join(tmp, "src"), {
		recursive: true,
		filter: (p) => !p.includes("__tests__"),
	});
	root = PathValidator.safeResolvePath(".", tmp);
	index = await AiIndexBuilder.fromDirectory(root);
}, 60_000);

afterAll(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("symbols over packages/core/src", () => {
	it("finds both trimToMaxLines declarations, each focusable with evidence (REQ-SYM-2..4)", () => {
		const report = SymbolQuery.name(index, "trimToMaxLines", root);
		expect(report.matches.map((m) => m.path)).toEqual([
			"src/formatters/formatter-utils.ts",
			"src/managers/next-prompt-writer.ts",
		]);
		expect(report.ambiguous).toBe(false);
		for (const m of report.matches) {
			expect(m.focusable).toBe(true);
			expect(m.evidence).not.toBeNull();
			expect(m.freshness).toBe("current");
		}

		const focused = UnitFocusResolver.resolve({
			tasks: [{ text: "Fix `trimToMaxLines`", status: "todo" }],
			index,
		}).focused;
		expect(report.matches.map((m) => m.ref).sort()).toEqual(focused.map((u) => u.ref).sort());

		const text = SymbolQuery.renderText(report);
		expect(text[0]).toBe("trimToMaxLines — 2 declarations");
		expect(text.filter((l) => l.endsWith("would focus"))).toHaveLength(2);
	});

	it("agrees with the prompt's own plan, which focuses the same refs (REQ-SYM-3)", () => {
		const plan = LayerResolver.plan({
			chunkFiles: [],
			alwaysIncludeFiles: [],
			index,
			tasks: [{ text: "Fix `trimToMaxLines`", status: "todo" }],
		});
		const report = SymbolQuery.name(index, "trimToMaxLines", root);
		const focusable = report.matches.filter((m) => m.focusable).map((m) => m.ref);
		expect(plan.focus.map((u) => u.ref).sort()).toEqual(focusable.sort());
	});

	it("reports a real file's exports and units as indexed (REQ-SYM-1)", () => {
		const report = SymbolQuery.file(index, "src/calculators/unit-focus.ts", root);
		expect(report?.freshness).toBe("current");
		const ids = report?.units?.map((u) => u.id) ?? [];
		expect(ids).toEqual(expect.arrayContaining(["UnitFocusResolver", "isCodeShaped"]));
		expect(report?.exports.map((e) => e.name)).toContain("UnitFocusResolver");
	});
});
