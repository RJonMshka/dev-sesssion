/**
 * Round-trip guard for FILE_INDEX.md against this repository's own index.
 *
 * The synthetic fixtures in the unit suite are small and tidy. The real
 * `.session/FILE_INDEX.md` is not: 21 sections in deliberately non-numeric
 * order, headings carrying titles and `[COMPLETE <date>]` markers, `###`
 * sub-sections splitting a chunk across several tables, ~10 lines of design
 * prose between tables, and 64 rows where one file carries a different purpose
 * in each section it appears in.
 *
 * Every one of those was destroyed by `save()` before the layout-preserving
 * rewrite. Asserting against the real document is the point — a hand-written
 * fixture cannot capture a shape nobody thought to write down.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type DirectoryResult, dir } from "tmp-promise";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileIndexManager } from "../packages/core/src/managers/file-index-manager.js";
import type { ValidatedPath } from "../packages/security/src/validators/path-validator.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_INDEX = path.join(REPO_ROOT, ".session", "FILE_INDEX.md");

/** Strips the one line `save()` is expected to change. */
function withoutDate(content: string): string {
	return content.replace(/^last_updated:.*$/m, "last_updated: <date>");
}

describe("FILE_INDEX.md round-trip against the real session index", () => {
	let tmp: DirectoryResult;

	beforeEach(async () => {
		tmp = await dir({ unsafeCleanup: true });
	});

	afterEach(async () => {
		await tmp.cleanup();
	});

	it("load → save reproduces the document byte-for-byte apart from last_updated", () => {
		const original = fs.readFileSync(REAL_INDEX, "utf-8");
		fs.writeFileSync(path.join(tmp.path, "FILE_INDEX.md"), original, "utf-8");

		const entries = FileIndexManager.load(tmp.path as ValidatedPath);
		FileIndexManager.save(tmp.path as ValidatedPath, entries);
		const after = fs.readFileSync(path.join(tmp.path, "FILE_INDEX.md"), "utf-8");

		expect(withoutDate(after)).toBe(withoutDate(original));
	});

	it("is stable under a second round-trip", () => {
		const original = fs.readFileSync(REAL_INDEX, "utf-8");
		const indexPath = path.join(tmp.path, "FILE_INDEX.md");
		fs.writeFileSync(indexPath, original, "utf-8");

		for (let pass = 0; pass < 2; pass++) {
			const entries = FileIndexManager.load(tmp.path as ValidatedPath);
			FileIndexManager.save(tmp.path as ValidatedPath, entries);
		}

		expect(withoutDate(fs.readFileSync(indexPath, "utf-8"))).toBe(withoutDate(original));
	});

	it("attributes fractional and suffixed chunk sections without bleeding into neighbours", () => {
		fs.writeFileSync(
			path.join(tmp.path, "FILE_INDEX.md"),
			fs.readFileSync(REAL_INDEX, "utf-8"),
			"utf-8",
		);

		const entries = FileIndexManager.load(tmp.path as ValidatedPath);
		const tagged = (tag: number) => entries.filter((e) => e.chunk_tags.includes(tag)).length;

		// `## Chunk 3.5` gets its own tag rather than folding into chunk 3, and the
		// 25 rows under `## Chunk 13A`/`13B` no longer land on chunk 12.
		expect(tagged(3.5)).toBeGreaterThan(0);
		expect(tagged(12)).toBeLessThan(20);
	});
});
