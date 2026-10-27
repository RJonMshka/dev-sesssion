/**
 * PlanTags — the files `init` tags, moved from the CLI into core
 * (LLD-tagging.md, REQ-IDX-42, -43).
 *
 * A lock on the refactor: it passed as soon as the move was done. The files
 * are walked by the real walker from a temp project.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inferPurpose, PlanTags } from "../calculators/plan-tags.js";
import type { PlanChunk } from "../schemas/index.js";
import { GitignoreAwareWalker } from "../walkers/gitignore-aware-walker.js";

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-tags-"));
	for (const rel of ["src/auth/login.ts", "src/auth/logout.ts", "src/db/pool.ts", "CLAUDE.md"]) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), "export const x = 1;\n");
	}
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const CHUNKS: PlanChunk[] = [
	{
		chunk_id: 1,
		title: "Auth",
		depends_on: [],
		tasks: [{ text: "Fix src/auth/login.ts redirect", status: "todo" }],
	},
	{
		chunk_id: 2,
		title: "Pool",
		depends_on: [],
		tasks: [{ text: "Tune it", status: "todo" }],
		files: ["src/db/pool.ts", "src/auth/login.ts"],
	},
];

describe("PlanTags.fromPlan", () => {
	it("tags each named file to every chunk naming it, and nothing else (REQ-IDX-42, -43)", () => {
		const files = GitignoreAwareWalker.walk(root);
		const entries = PlanTags.fromPlan(files, CHUNKS, new Set(["CLAUDE.md"]));
		const tags = Object.fromEntries(entries.map((e) => [e.filepath, e.chunk_tags]));
		// logout.ts shares login.ts's directory and is named by nothing.
		expect(tags).toEqual({ "src/auth/login.ts": [1, 2], "src/db/pool.ts": [2] });
		for (const e of entries) {
			expect(e.purpose).toBe(inferPurpose(e.filepath));
			expect(e.token_cost).toBeGreaterThan(0);
		}
	});

	it("leaves out a file named only by a done task", () => {
		const files = GitignoreAwareWalker.walk(root);
		const done: PlanChunk[] = [
			{ ...CHUNKS[0], tasks: [{ text: "Fix src/auth/login.ts", status: "done" }] } as PlanChunk,
		];
		expect(PlanTags.fromPlan(files, done, new Set())).toEqual([]);
	});
});

describe("inferPurpose", () => {
	it("names common files and falls back by extension", () => {
		expect(inferPurpose("package.json")).toBe("Package manifest");
		expect(inferPurpose("src/index.ts")).toBe("src entry point");
		expect(inferPurpose("src/a.test.ts")).toBe("Tests for a");
		expect(inferPurpose("src/pool.ts")).toBe("pool module");
		expect(inferPurpose("x.bin")).toBe("Project file");
	});
});
