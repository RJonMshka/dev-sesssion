/**
 * Files a chunk will create (LLD-new-files.md, area NEW).
 *
 * The index is built by the real extractor and builder from files on disk, and
 * round-tripped through YAML, so neighbours are chosen from what `init` stores.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { AiIndex } from "../annotation/types.js";
import { NewFiles } from "../calculators/new-files.js";
import type { PlanChunk } from "../schemas/index.js";

const FILES: Record<string, string> = {
	"index.ts": "export const root = 1;\n",
	"apps/shell/vite.config.ts": "export default {};\n",
	"apps/shell/src/App.tsx": "export function App() { return null; }\n",
	"apps/shell/src/main.ts": "export const main = 1;\n",
	"apps/shell/src/routing/MFEOutlet.tsx": "export function MFEOutlet() { return null; }\n",
	"apps/shell/src/routing/mfe-registry.ts": "export const registry = [];\n",
	"apps/shell/src/routing/paths.ts": "export const paths = [];\n",
	"apps/shell/src/routing/guards.ts": "export const guards = [];\n",
	"apps/shell/src/routing/links.ts": "export const links = [];\n",
};

let root: string;
let index: AiIndex;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "new-files-"));
	const extractor = new AutoExtractor();
	const parsed = Object.entries(FILES).map(([rel, content]) => {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf-8");
		return extractor.extractFile(abs as ValidatedPath);
	});
	index = AiIndexBuilder.deserialize(AiIndexBuilder.serialize(AiIndexBuilder.build(parsed, root)));
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function chunk(files: string[], taskStatus: "todo" | "done" = "todo"): PlanChunk {
	return {
		chunk_id: 8,
		title: "Polish",
		depends_on: [],
		files,
		tasks: [{ text: "Do it", status: taskStatus }],
	};
}

/** `absent` against the built index, with no FILE_INDEX entries. */
function absent(c: PlanChunk): string[] {
	return NewFiles.absent(c, root, [], index);
}

function neighbours(absent: string[], taken: string[] = []): string[] {
	return NewFiles.neighbours({ absent, index, taken: new Set(taken), activeChunk: 8 }).map(
		(e) => e.filepath,
	);
}

describe("NewFiles.absent", () => {
	it("returns plan-named paths not on disk, and not those that are (REQ-NEW-1)", () => {
		const got = absent(chunk(["apps/shell/src/routing/transitions.ts", "apps/shell/src/App.tsx"]));
		expect(got).toEqual(["apps/shell/src/routing/transitions.ts"]);
	});

	it("drops paths that are not path-shaped or leave the root (REQ-NEW-2)", () => {
		const got = absent(
			chunk(["src/a`b.ts", "src/a b.ts", 'src/"x".ts', "../out.ts", "src/ok-1_+@x.ts"]),
		);
		expect(got).toEqual(["src/ok-1_+@x.ts"]);
	});

	it("returns nothing when every task is done (REQ-NEW-3)", () => {
		expect(absent(chunk(["src/new.ts"], "done"))).toEqual([]);
	});

	it("does not state a bare name or a path that names an existing file by its tail (REQ-NEW-1)", () => {
		// DevNexus prose: `node.props`, `mfe-registry.ts`, `src/lifecycle.ts`.
		const got = absent(chunk(["node.props", "mfe-registry.ts", "routing/paths.ts", "src/gone.ts"]));
		expect(got).toEqual(["src/gone.ts"]);
	});

	it("counts a tagged FILE_INDEX entry as existing (REQ-NEW-1)", () => {
		const entries = [{ filepath: "docs/notes.md", chunk_tags: [8], purpose: "Docs" }];
		expect(NewFiles.absent(chunk(["docs/notes.md"]), root, entries, null)).toEqual([]);
	});
});

describe("NewFiles.neighbours", () => {
	it("loads indexed files in the new file's own directory, same extension first (REQ-NEW-4)", () => {
		const got = neighbours(["apps/shell/src/routing/transitions.ts"]);
		expect(got).toHaveLength(3);
		for (const f of got) expect(f.startsWith("apps/shell/src/routing/")).toBe(true);
		expect(got.every((f) => f.endsWith(".ts"))).toBe(true);
	});

	it("falls back to the nearest ancestor that holds indexed files (REQ-NEW-4)", () => {
		const got = neighbours(["apps/shell/src/hooks/usePreload.ts"]);
		expect(got).toEqual(["apps/shell/src/main.ts", "apps/shell/src/App.tsx"]);
	});

	it("never uses the project root (REQ-NEW-4)", () => {
		expect(neighbours(["e2e/golden-path.spec.ts"])).toEqual([]);
	});

	it("does not climb past a directory whose files are all loaded already (REQ-NEW-4)", () => {
		// DevNexus phase 8: three new components in apps/shell/src/components
		// climbed to apps/shell and loaded build output.
		const got = neighbours(
			["apps/shell/src/hooks/usePreload.ts"],
			["apps/shell/src/main.ts", "apps/shell/src/App.tsx"],
		);
		expect(got).toEqual([]);
	});

	it("skips files already loaded or trimmed (REQ-NEW-4)", () => {
		const got = neighbours(["apps/shell/src/hooks/usePreload.ts"], ["apps/shell/src/main.ts"]);
		expect(got).toEqual(["apps/shell/src/App.tsx"]);
	});

	it("caps neighbours at 8 per chunk, deduped (REQ-NEW-4)", () => {
		const got = neighbours([
			"apps/shell/src/routing/a.ts",
			"apps/shell/src/routing/b.tsx",
			"apps/shell/src/hooks/c.ts",
			"apps/shell/src/x/d.ts",
		]);
		expect(new Set(got).size).toBe(got.length);
		expect(got.length).toBeLessThanOrEqual(8);
		expect(got).toContain("apps/shell/src/routing/MFEOutlet.tsx");
	});

	it("tags each neighbour to the active chunk (REQ-NEW-4)", () => {
		const [entry] = NewFiles.neighbours({
			absent: ["apps/shell/src/routing/transitions.ts"],
			index,
			taken: new Set(),
			activeChunk: 8,
		});
		expect(entry?.chunk_tags).toEqual([8]);
		expect(entry?.purpose).toBe("Beside apps/shell/src/routing/transitions.ts");
	});

	it("loads nothing without an ai-index (REQ-NEW-4)", () => {
		expect(
			NewFiles.neighbours({
				absent: ["apps/shell/src/routing/x.ts"],
				index: null,
				taken: new Set(),
				activeChunk: 8,
			}),
		).toEqual([]);
	});
});
