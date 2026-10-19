/**
 * Gate-restoration coverage.
 *
 * Requirements: docs/plan/LLD-eval-harness.md (area EVAL).
 *
 * `restoreTree` is the integrity guard that stops a graded agent editing the
 * tests that grade it. It also produced the sharpest categorical result in the
 * dataset — control tampered in 7 of 8 runs, bootstrap in 0 of 8 — so a missed
 * comparison here silently weakens a published finding rather than failing loudly.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreTree, snapshotTree } from "../harness/workspace.js";

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-ws-test-"));
	await fs.mkdir(path.join(dir, "tests"), { recursive: true });
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

/** Writes a file under the workspace, creating parents. */
const write = async (rel: string, body: string): Promise<void> => {
	const abs = path.join(dir, rel);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, body, "utf8");
};

/** Reads a file under the workspace, or null when absent. */
const read = (rel: string): Promise<string | null> =>
	fs.readFile(path.join(dir, rel), "utf8").catch(() => null);

describe("gate restoration", () => {
	it("reports nothing and changes nothing when the tree is untouched (REQ-EVAL-5)", async () => {
		await write("tests/a.test.ts", "expect(1).toBe(1);");
		const snap = await snapshotTree(dir, "tests");

		expect(await restoreTree(dir, "tests", snap)).toEqual([]);
		expect(await read("tests/a.test.ts")).toBe("expect(1).toBe(1);");
	});

	it("restores a modified gate file and reports it (REQ-EVAL-5)", async () => {
		await write("tests/a.test.ts", "expect(1).toBe(1);");
		const snap = await snapshotTree(dir, "tests");

		await write("tests/a.test.ts", "expect(true).toBe(true); // weakened");

		expect(await restoreTree(dir, "tests", snap)).toEqual(["tests/a.test.ts"]);
		expect(await read("tests/a.test.ts")).toBe("expect(1).toBe(1);");
	});

	it("deletes a gate file the agent added and reports it (REQ-EVAL-5)", async () => {
		await write("tests/a.test.ts", "original");
		const snap = await snapshotTree(dir, "tests");

		await write("tests/extra.test.ts", "expect(true).toBe(true);");

		expect(await restoreTree(dir, "tests", snap)).toEqual(["tests/extra.test.ts"]);
		expect(await read("tests/extra.test.ts")).toBeNull();
	});

	it("recreates a gate file the agent deleted and reports it (REQ-EVAL-5)", async () => {
		await write("tests/a.test.ts", "original");
		const snap = await snapshotTree(dir, "tests");

		await fs.rm(path.join(dir, "tests/a.test.ts"));

		expect(await restoreTree(dir, "tests", snap)).toEqual(["tests/a.test.ts"]);
		expect(await read("tests/a.test.ts")).toBe("original");
	});

	it("reports every tampered path when several change at once (REQ-EVAL-5)", async () => {
		await write("tests/a.test.ts", "a");
		await write("tests/nested/b.test.ts", "b");
		const snap = await snapshotTree(dir, "tests");

		await write("tests/a.test.ts", "a-edited");
		await fs.rm(path.join(dir, "tests/nested/b.test.ts"));
		await write("tests/c.test.ts", "c-added");

		expect((await restoreTree(dir, "tests", snap)).sort()).toEqual([
			"tests/a.test.ts",
			"tests/c.test.ts",
			"tests/nested/b.test.ts",
		]);
		expect(await read("tests/a.test.ts")).toBe("a");
		expect(await read("tests/nested/b.test.ts")).toBe("b");
		expect(await read("tests/c.test.ts")).toBeNull();
	});

	it("snapshots an absent directory as empty rather than throwing (REQ-EVAL-5)", async () => {
		expect((await snapshotTree(dir, "does-not-exist")).size).toBe(0);
	});
});
