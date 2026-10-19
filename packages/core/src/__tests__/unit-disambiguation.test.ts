/**
 * Choosing among declarations that share a name, by proof of use
 * (LLD-code-units.md, REQ-UNIT-30, REQ-UNIT-32, REQ-UNIT-33).
 *
 * The index is built by the real extractor over real files, so the evidence the
 * resolver weighs is what the pipeline actually records.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { AiIndex } from "../annotation/types.js";
import { LayerResolver } from "../calculators/layer-resolver.js";
import { UnitFocusResolver } from "../calculators/unit-focus.js";
import { ContextManifest } from "../managers/context-manifest.js";

const FILES: Record<string, string> = {
	// The trimToMaxLines shape from packages/core: a shared export, imported
	// elsewhere, and a private copy called inside its own file.
	"src/fmt.ts": "export function trimLines(): void {}\n",
	"src/writer.ts": [
		'import { trimLines as shared } from "./fmt.js";',
		"function trimLines(): void {}",
		"export function write(): void {",
		"  trimLines();",
		"  shared();",
		"}",
		"",
	].join("\n"),
	"src/other.ts": 'import { trimLines } from "./fmt.js";\ntrimLines();\n',

	// Two exports, only one ever imported.
	"src/a.ts": "export function pickMe(): void {}\n",
	"src/b.ts": "export function pickMe(): void {}\n",
	"src/c.ts": 'import { pickMe } from "./a.js";\npickMe();\n',

	// Two declarations, neither used anywhere.
	"src/dead1.ts": "export function deadHelper(): void {}\n",
	"src/dead2.ts": "export function deadHelper(): void {}\n",

	// Four private copies, each used in its own file.
	...Object.fromEntries(
		[1, 2, 3, 4].map((n) => [
			`src/copy${String(n)}.ts`,
			"function manyCopies(): void {}\nmanyCopies();\n",
		]),
	),

	// The same member name on two objects; only one is used across files.
	"src/s1.ts": "export const StoreApi = {\n  refreshAll(): void {},\n};\n",
	"src/s2.ts": "export const CacheApi = {\n  refreshAll(): void {},\n};\n",
	"src/use.ts": 'import { StoreApi } from "./s1.js";\nStoreApi.refreshAll();\n',
};

let root: string;
let index: AiIndex;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "unit-disambiguation-"));
	const extractor = new AutoExtractor();
	const parsed = Object.entries(FILES).map(([rel, content]) => {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf-8");
		return extractor.extractFile(abs as ValidatedPath);
	});
	// Round-trip through YAML so the resolver reads what is actually stored.
	index = AiIndexBuilder.deserialize(AiIndexBuilder.serialize(AiIndexBuilder.build(parsed, root)));
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** Resolves one todo task. */
function resolve(text: string) {
	return UnitFocusResolver.resolve({ tasks: [{ text, status: "todo" }], index });
}

describe("disambiguation by proof of use", () => {
	it("focuses both an imported export and a private copy used in its file (REQ-UNIT-30)", () => {
		const r = resolve("trimLines must keep the Focus line");
		expect(r.focused.map((u) => u.ref).sort()).toEqual([
			"src/fmt.ts#trimLines",
			"src/writer.ts#trimLines",
		]);
		expect(r.ambiguous).toEqual([]);
	});

	it("focuses only the declaration that is used (REQ-UNIT-30)", () => {
		const r = resolve("pickMe should log");
		expect(r.focused.map((u) => u.ref)).toEqual(["src/a.ts#pickMe"]);
	});

	it("proves a member used through an imported parent (REQ-UNIT-30)", () => {
		const r = resolve("refreshAll leaks a timer");
		expect(r.focused.map((u) => u.ref)).toEqual(["src/s1.ts#StoreApi.refreshAll"]);
	});

	it("focuses nothing when no declaration has evidence (REQ-UNIT-32)", () => {
		const r = resolve("Remove deadHelper");
		expect(r.focused).toEqual([]);
		expect(r.ambiguous).toEqual(["deadHelper"]);
	});

	it("focuses nothing when more than three declarations have evidence (REQ-UNIT-32)", () => {
		const r = resolve("Inline manyCopies");
		expect(r.focused).toEqual([]);
		expect(r.ambiguous).toEqual(["manyCopies"]);
	});

	it("does not attach evidence when the name was unique", () => {
		const r = resolve("`write` should flush");
		expect(r.focused.map((u) => u.ref)).toEqual(["src/writer.ts#write"]);
		expect(r.focused[0]?.evidence).toBeUndefined();
	});

	it("records the evidence for each chosen unit in the manifest (REQ-UNIT-33)", () => {
		const plan = LayerResolver.plan({
			chunkFiles: [],
			alwaysIncludeFiles: [],
			tasks: [{ text: "trimLines must keep the Focus line", status: "todo" }],
			index,
		});
		const m = ContextManifest.build({ plan, index, prompt: "p", activeChunk: 1 });
		const byRef = new Map(m.entries.map((e) => [e.ref, e.evidence]));
		expect(byRef.get("src/fmt.ts#trimLines")).toBe("imported by 2 files");
		expect(byRef.get("src/writer.ts#trimLines")).toBe("referenced 1× in its file");
	});
});
