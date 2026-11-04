/**
 * `AiIndexBuilder.refresh` — bringing an index up to date with the tree
 * (LLD-symbols.md, REQ-SYM-20..23).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import type { AiIndex } from "../annotation/types.js";

let root: ValidatedPath;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-index-refresh-")) as ValidatedPath;
	fs.mkdirSync(path.join(root, "src"));
	write("src/a.ts", "export function a(): number {\n\treturn 1;\n}\n");
	write("src/b.ts", "export const b = 2;\n");
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
	fs.writeFileSync(path.join(root, rel), content);
}

const built = (): Promise<AiIndex> => AiIndexBuilder.fromDirectory(root);

describe("AiIndexBuilder.refresh", () => {
	it("keeps unchanged entries and re-reads nothing when the tree is as indexed (REQ-SYM-21)", async () => {
		const before = await built();

		const r = await AiIndexBuilder.refresh(root, before);

		expect(r.reread).toEqual([]);
		expect(r.added).toEqual([]);
		expect(r.dropped).toEqual([]);
		expect(r.index.files).toEqual(before.files);
	});

	it("re-reads a changed file, adds a new one, drops a deleted one (REQ-SYM-20)", async () => {
		const before = await built();
		write(
			"src/a.ts",
			"export function a(): number {\n\treturn 1;\n}\nexport function done(): void {}\n",
		);
		write("src/c.ts", "export const c = 3;\n");
		fs.rmSync(path.join(root, "src/b.ts"));

		const r = await AiIndexBuilder.refresh(root, before);

		expect(r.reread).toEqual(["src/a.ts"]);
		expect(r.added).toEqual(["src/c.ts"]);
		expect(r.dropped).toEqual(["src/b.ts"]);
		expect(Object.keys(r.index.files).sort()).toEqual(["src/a.ts", "src/c.ts"]);
		// Against a fresh build of the same tree, not hand-written entries.
		expect(r.index.files).toEqual((await built()).files);
	});

	it("re-reads an entry that records no hash (REQ-SYM-22)", async () => {
		const before = await built();
		const { hash: _dropped, ...noHash } = before.files["src/b.ts"] ?? { hash: "" };
		const old = { ...before, files: { ...before.files, "src/b.ts": noHash } } as AiIndex;

		const r = await AiIndexBuilder.refresh(root, old);

		expect(r.reread).toEqual(["src/b.ts"]);
		expect(r.index.files["src/b.ts"]).toEqual(before.files["src/b.ts"]);
	});

	it("records a cap and keeps to it when refreshing (REQ-SYM-23)", async () => {
		const capped = await AiIndexBuilder.fromDirectory(root, { maxFiles: 1 });
		expect(capped.max_files).toBe(1);
		write("src/0-first.ts", "export const z = 0;\n");

		const r = await AiIndexBuilder.refresh(root, capped);

		expect(Object.keys(r.index.files)).toHaveLength(1);
		expect(r.index.max_files).toBe(1);
	});

	it("round-trips max_files through serialize and deserialize (REQ-SYM-23)", async () => {
		const capped = await AiIndexBuilder.fromDirectory(root, { maxFiles: 1 });
		const back = AiIndexBuilder.deserialize(AiIndexBuilder.serialize(capped));

		expect(back.max_files).toBe(1);
		expect(AiIndexBuilder.deserialize(AiIndexBuilder.serialize(await built())).max_files).toBe(
			undefined,
		);
	});
});
