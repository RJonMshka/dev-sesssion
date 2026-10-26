/**
 * Tags learned from touch, saved into the real hand-maintained FILE_INDEX.md
 * (LLD-tagging.md, REQ-IDX-35).
 *
 * The fixture is copied verbatim. Adding a tag may add rows and nothing else:
 * every original line stays, in order, apart from the `last_updated` date
 * that every save refreshes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type DirectoryResult, dir } from "tmp-promise";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inferPurpose } from "../packages/core/src/calculators/plan-tags.js";
import { FileIndexManager } from "../packages/core/src/managers/file-index-manager.js";
import type { ValidatedPath } from "../packages/security/src/validators/path-validator.js";

const TESTS_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REAL_INDEX = path.join(TESTS_ROOT, "fixtures", "messy-file-index", "FILE_INDEX.md");

/** Lines of a FILE_INDEX.md, with the date every save refreshes masked. */
function lines(content: string): string[] {
	return content.replace(/^last_updated:.*$/m, "last_updated: <date>").split("\n");
}

describe("touch tags in a hand-maintained index (REQ-IDX-35)", () => {
	let tmp: DirectoryResult;

	beforeEach(async () => {
		tmp = await dir({ unsafeCleanup: true });
		fs.copyFileSync(REAL_INDEX, path.join(tmp.path, "FILE_INDEX.md"));
	});

	afterEach(async () => {
		await tmp.cleanup();
	});

	it("adds two rows inside their sections and changes no other line", () => {
		const sessionDir = tmp.path as ValidatedPath;
		const before = fs.readFileSync(path.join(tmp.path, "FILE_INDEX.md"), "utf-8");
		const entries = FileIndexManager.load(sessionDir);
		const existing = entries.find((e) => !e.chunk_tags.includes(0) && !e.chunk_tags.includes(3.5));
		expect(existing).toBeDefined();
		if (existing === undefined) return;

		let next = FileIndexManager.tag(entries, "src/touched.ts", [9], inferPurpose("src/touched.ts"));
		next = FileIndexManager.tag(next, existing.filepath, [3.5], "ignored for an existing row");
		FileIndexManager.save(sessionDir, next);

		const after = fs.readFileSync(path.join(tmp.path, "FILE_INDEX.md"), "utf-8");
		const old = lines(before);
		const now = lines(after);
		expect(now.length).toBe(old.length + 2);

		// Every original line is still there, in order.
		let i = 0;
		const added: { line: string; at: number }[] = [];
		now.forEach((line, at) => {
			if (i < old.length && line === old[i]) i++;
			else added.push({ line, at });
		});
		expect(i).toBe(old.length);
		expect(added.map((a) => a.line)).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^\| src\/touched\.ts \| touched module \|$/),
				expect.stringContaining(`| ${existing.filepath} |`),
			]),
		);

		// Each new row sits in the section for its chunk.
		const sectionOf = (at: number): string =>
			now
				.slice(0, at)
				.reverse()
				.find((l) => l.startsWith("## ")) ?? "";
		for (const a of added) {
			expect(sectionOf(a.at)).toMatch(
				a.line.includes("touched.ts") ? /^## Chunk 9 / : /^## Chunk 3\.5 /,
			);
		}

		const reloaded = FileIndexManager.load(sessionDir);
		expect(reloaded.find((e) => e.filepath === "src/touched.ts")?.chunk_tags).toEqual([9]);
		expect(reloaded.find((e) => e.filepath === existing.filepath)?.chunk_tags).toEqual(
			[...existing.chunk_tags, 3.5].sort((a, b) => a - b),
		);
	});
});
