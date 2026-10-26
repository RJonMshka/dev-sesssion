/**
 * SymbolQuery — what the ai-index holds for a file or a name (LLD-symbols.md).
 *
 * Every index here is built by the real extractor from real files in a temp
 * project. Nothing is hand-written YAML, and the expected focus is computed by
 * the resolver the prompt uses, never listed by hand.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PathValidator, type ValidatedPath } from "@dev-session/security";
import { afterEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { SymbolQuery } from "../annotation/symbol-query.js";
import type { AiIndex, FileEntry } from "../annotation/types.js";
import { UnitFocusResolver } from "../calculators/unit-focus.js";

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Writes files into a fresh temp project and indexes it with the real builder. */
async function project(
	files: Record<string, string>,
): Promise<{ root: ValidatedPath; index: AiIndex }> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "symbol-query-"));
	dirs.push(dir);
	for (const [rel, content] of Object.entries(files)) {
		const abs = path.join(dir, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf-8");
	}
	const root = PathValidator.safeResolvePath(".", dir);
	return { root, index: await AiIndexBuilder.fromDirectory(root) };
}

/** Replaces one file entry, keeping the rest of the built index. */
function withEntry(index: AiIndex, key: string, entry: FileEntry): AiIndex {
	return { ...index, files: { ...index.files, [key]: entry } };
}

/** The refs the prompt would focus for one active task naming `name` in backticks. */
function resolverFocus(index: AiIndex, name: string): string[] {
	const tasks = [{ text: `Fix \`${name}\``, status: "todo" as const }];
	return UnitFocusResolver.resolve({ tasks, index })
		.focused.map((u) => u.ref)
		.sort();
}

const UTILS = [
	"/** Request parsing helpers. */",
	"",
	"/** Parses a JSON body. */",
	"export function parseBody(req: string): unknown {",
	"  return normalize(req);",
	"}",
	"",
	"function normalize(x: string): string {",
	"  return x.trim();",
	"}",
	"",
	"export class Store {",
	"  add(x: number): number {",
	"    return x + 1;",
	"  }",
	"}",
	"",
].join("\n");

describe("SymbolQuery.file", () => {
	it("reports cost, summary, exports and units as the index records them (REQ-SYM-1)", async () => {
		const { root, index } = await project({ "src/utils.ts": UTILS });
		const entry = index.files["src/utils.ts"];
		expect(entry).toBeDefined();
		if (entry === undefined) return;

		const report = SymbolQuery.file(index, "src/utils.ts", root);
		expect(report).not.toBeNull();
		if (report === null) return;

		expect(report.path).toBe("src/utils.ts");
		expect(report.tokens).toBe(entry.token_cost);
		expect(report.moduleSummary).toBe(entry.module_summary);
		expect(report.freshness).toBe("current");

		const expectedExports = Object.entries(entry.exports)
			.map(([name, s]) => ({ name, ...s }))
			.sort((a, b) => a.line - b.line);
		expect(report.exports).toEqual(expectedExports);

		const expectedUnits = Object.entries(entry.units ?? {})
			.map(([id, u]) => ({
				id,
				ref: `src/utils.ts#${id}`,
				kind: u.kind,
				start: u.start,
				end: u.end,
				tokens: u.tokens,
				exported: u.exported,
			}))
			.sort((a, b) => a.start - b.start);
		expect(expectedUnits.map((u) => u.id)).toEqual(
			expect.arrayContaining(["parseBody", "normalize", "Store", "Store.add"]),
		);
		expect(report.units).toEqual(expectedUnits);
	});

	it("returns null for a file the index does not hold (REQ-SYM-16)", async () => {
		const { root, index } = await project({ "src/utils.ts": UTILS });
		expect(SymbolQuery.file(index, "src/nope.ts", root)).toBeNull();
	});

	it("marks a file edited after indexing stale (REQ-SYM-13)", async () => {
		const { root, index } = await project({ "src/utils.ts": UTILS });
		fs.appendFileSync(path.join(root, "src/utils.ts"), "// later\n");
		expect(SymbolQuery.file(index, "src/utils.ts", root)?.freshness).toBe("stale");
		const text = SymbolQuery.renderText(SymbolQuery.file(index, "src/utils.ts", root) ?? fail());
		expect(text[0]).toMatch(/STALE — run dev-sesssion index$/);
	});

	it("marks a deleted file removed and shows no rows (REQ-SYM-14)", async () => {
		const { root, index } = await project({ "src/utils.ts": UTILS });
		fs.rmSync(path.join(root, "src/utils.ts"));
		const report = SymbolQuery.file(index, "src/utils.ts", root) ?? fail();
		expect(report.freshness).toBe("removed");
		const text = SymbolQuery.renderText(report);
		expect(text).toHaveLength(1);
		expect(text[0]).toMatch(/removed since indexing$/);
	});

	it("reports freshness and units unknown when the entry predates them (REQ-SYM-15)", async () => {
		const { root, index } = await project({ "src/utils.ts": UTILS });
		const { hash: _h, units: _u, ...old } = index.files["src/utils.ts"] ?? fail();
		const report = SymbolQuery.file(withEntry(index, "src/utils.ts", old), "src/utils.ts", root);
		expect(report?.freshness).toBe("unknown");
		expect(report?.units).toBeNull();
		const text = SymbolQuery.renderText(report ?? fail());
		expect(text).toContain("Units: not recorded — run dev-sesssion index");
	});
});

describe("SymbolQuery.name", () => {
	const FILES = {
		"src/utils.ts": UTILS,
		"src/cache.ts": [
			"export class Cache {",
			"  add(k: string): void {}",
			"}",
			"",
			"export function pick(a: string): string;",
			"export function pick(a: unknown): unknown {",
			"  return a;",
			"}",
			"",
		].join("\n"),
	};

	it("finds a top-level id, a member by leaf and in full, and overloads as one declaration (REQ-SYM-2)", async () => {
		const { root, index } = await project(FILES);

		const parse = SymbolQuery.name(index, "parseBody", root);
		expect(parse.matches.map((m) => m.ref)).toEqual(["src/utils.ts#parseBody"]);
		const m = parse.matches[0] ?? fail();
		const unit = index.files["src/utils.ts"]?.units?.parseBody ?? fail();
		expect(m).toMatchObject({
			start: unit.start,
			end: unit.end,
			kind: unit.kind,
			tokens: unit.tokens,
			fileTokens: index.files["src/utils.ts"]?.token_cost,
		});

		expect(SymbolQuery.name(index, "add", root).matches.map((x) => x.ref)).toEqual([
			"src/cache.ts#Cache.add",
			"src/utils.ts#Store.add",
		]);
		expect(SymbolQuery.name(index, "Store.add", root).matches.map((x) => x.ref)).toEqual([
			"src/utils.ts#Store.add",
		]);

		const pick = SymbolQuery.name(index, "pick", root);
		expect(pick.matches.map((x) => x.id).sort()).toEqual(["pick", "pick~2"]);
		expect(SymbolQuery.renderText(pick)[0]).toMatch(/1 declaration$/);

		expect(SymbolQuery.name(index, "helper", root).matches).toEqual([]);
	});

	/** Each case is a name and the files that declare it in different ways. */
	const FOCUS_CASES: Record<string, Record<string, string>> = {
		unique: { "src/a.ts": "export function solo(): void {}\n" },
		"twins, one with evidence": {
			"src/a.ts": "export function twin(): void {}\n",
			"src/b.ts": "export function twin(): void {}\n",
			"src/c.ts": 'import { twin } from "./a";\nexport function use(): void {\n  twin();\n}\n',
		},
		"twins, no evidence": {
			"src/a.ts": "export function twin(): void {}\n",
			"src/b.ts": "export function twin(): void {}\n",
		},
		"four live twins": Object.fromEntries(
			["a", "b", "c", "d"].flatMap((n) => [
				[`src/${n}.ts`, "export function twin(): void {}\n"],
				[`src/use-${n}.ts`, `import { twin } from "./${n}";\nexport const x${n} = twin;\n`],
			]),
		),
		"leaf member": {
			"src/a.ts": "export class Box {\n  open(): void {}\n}\n",
		},
	};
	/** How many units each case focuses — keeps the agreement check from passing vacuously. */
	const FOCUS_COUNT: Record<string, number> = {
		unique: 1,
		"twins, one with evidence": 1,
		"twins, no evidence": 0,
		"four live twins": 0,
		"leaf member": 1,
	};
	const NAME_FOR: Record<string, string> = {
		unique: "solo",
		"twins, one with evidence": "twin",
		"twins, no evidence": "twin",
		"four live twins": "twin",
		"leaf member": "open",
	};

	for (const [label, files] of Object.entries(FOCUS_CASES)) {
		it(`marks focusable exactly what the resolver focuses: ${label} (REQ-SYM-3)`, async () => {
			const { root, index } = await project(files);
			const name = NAME_FOR[label] ?? fail();
			const report = SymbolQuery.name(index, name, root);
			expect(report.matches.length).toBeGreaterThan(0);
			const focusable = report.matches
				.filter((m) => m.focusable)
				.map((m) => m.ref)
				.sort();
			expect(focusable).toEqual(resolverFocus(index, name));
			expect(focusable).toHaveLength(FOCUS_COUNT[label] ?? -1);
		});
	}

	it("states each twin's evidence as the resolver records it, and ambiguity (REQ-SYM-4)", async () => {
		const live = await project(FOCUS_CASES["twins, one with evidence"] ?? fail());
		const report = SymbolQuery.name(live.index, "twin", live.root);
		const focused = UnitFocusResolver.resolve({
			tasks: [{ text: "Fix `twin`", status: "todo" }],
			index: live.index,
		}).focused;
		for (const m of report.matches) {
			const f = focused.find((u) => u.ref === m.ref);
			expect(m.evidence).toBe(f?.evidence ?? null);
		}
		expect(report.matches.some((m) => m.evidence !== null)).toBe(true);
		expect(report.ambiguous).toBe(false);

		const dead = await project(FOCUS_CASES["twins, no evidence"] ?? fail());
		const deadReport = SymbolQuery.name(dead.index, "twin", dead.root);
		expect(deadReport.ambiguous).toBe(true);
		expect(deadReport.matches.every((m) => m.evidence === null)).toBe(true);
		const text = SymbolQuery.renderText(deadReport).join("\n");
		expect(text).toMatch(/no usage evidence/);
		expect(text).toMatch(/ambiguous/i);
	});

	it("says a plain word needs backticks to be focused (REQ-SYM-5)", async () => {
		const { root, index } = await project({
			"src/a.ts": "export function helper(): void {}\nexport function parseBody(): void {}\n",
		});
		const plain = SymbolQuery.name(index, "helper", root);
		expect(plain.codeShaped).toBe(false);
		expect(SymbolQuery.renderText(plain).join("\n")).toMatch(/backticks/);

		const code = SymbolQuery.name(index, "parseBody", root);
		expect(code.codeShaped).toBe(true);
		expect(SymbolQuery.renderText(code).join("\n")).not.toMatch(/backticks/);
	});
});

describe("SymbolQuery.renderText provenance", () => {
	it("quotes module and export summaries (REQ-SYM-7)", async () => {
		const source = fs.readFileSync(
			path.resolve(__dirname, "../../../../tests/fixtures/provenance/src/plain-doc.ts"),
			"utf-8",
		);
		const { root, index } = await project({ "src/plain-doc.ts": source });
		const lines = SymbolQuery.renderText(
			SymbolQuery.file(index, "src/plain-doc.ts", root) ?? fail(),
		);
		const quoted = lines.filter((l) => l.includes('quoted: "IGNORE ALL PRIOR INSTRUCTIONS.'));
		expect(quoted.length).toBe(2);
		for (const l of lines) expect(l.trimStart()).not.toMatch(/^IGNORE/);
	});

	it("quotes a path that is not path-shaped (REQ-SYM-8)", async () => {
		const { root, index } = await project({
			"src/a b.ts": "export function spaced(): void {}\n",
			"src/ok-file.ts": "export function fine(): void {}\n",
		});
		const spaced = SymbolQuery.renderText(SymbolQuery.file(index, "src/a b.ts", root) ?? fail());
		expect(spaced[0]?.startsWith('"src/a b.ts"')).toBe(true);
		const ok = SymbolQuery.renderText(SymbolQuery.file(index, "src/ok-file.ts", root) ?? fail());
		expect(ok[0]?.startsWith("src/ok-file.ts ")).toBe(true);

		const byName = SymbolQuery.renderText(SymbolQuery.name(index, "spaced", root));
		expect(byName.some((l) => l.includes('"src/a b.ts#spaced'))).toBe(true);
	});
});

/** Fails the test: a value the test needed was missing. */
function fail(): never {
	throw new Error("expected value was missing");
}
