/**
 * Tagging on touch over real git repositories (LLD-tagging.md, REQ-IDX-19..33).
 *
 * Every observation comes from `SessionBase.capture` and `TouchDetector.detect`
 * running real git in a temp repository. A mocked git would miss exactly what
 * these exist to catch: quoted paths, collapsed directories, rename arrows,
 * other people's commits arriving through a pull.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { type DirectoryResult, dir } from "tmp-promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contentHash } from "../packages/core/src/annotation/unit-extractor.js";
import {
	SessionBase,
	TouchDetector,
	type TouchObservation,
	TouchTagger,
} from "../packages/core/src/calculators/touch-tags.js";
import type { PlanChunk } from "../packages/core/src/schemas/index.js";

const EMAIL = "me@example.com";

let tmp: DirectoryResult;
let cwd: string;
let globalConfig: DirectoryResult;
const savedEnv = { ...process.env };

// The user's own ~/.gitconfig must not leak in: a global user.email would
// make "unset" untestable, and signing or hooks would change what commits do.
beforeAll(async () => {
	globalConfig = await dir({ unsafeCleanup: true });
	const empty = path.join(globalConfig.path, "gitconfig");
	fs.writeFileSync(empty, "");
	process.env.GIT_CONFIG_GLOBAL = empty;
	process.env.GIT_CONFIG_NOSYSTEM = "1";
});

afterAll(async () => {
	process.env.GIT_CONFIG_GLOBAL = savedEnv.GIT_CONFIG_GLOBAL;
	process.env.GIT_CONFIG_NOSYSTEM = savedEnv.GIT_CONFIG_NOSYSTEM;
	if (savedEnv.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL;
	if (savedEnv.GIT_CONFIG_NOSYSTEM === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
	await globalConfig.cleanup();
});

/** Runs git in the repo and returns stdout. */
function git(args: string[], at = cwd): string {
	return execFileSync("git", args, { cwd: at, encoding: "utf-8" }).trim();
}

/** Writes a file under the repo, creating directories. */
function write(rel: string, content: string | Buffer, at = cwd): void {
	fs.mkdirSync(path.dirname(path.join(at, rel)), { recursive: true });
	fs.writeFileSync(path.join(at, rel), content);
}

/** Commits everything as the given author. */
function commitAll(message: string, email = EMAIL, at = cwd): void {
	git(["add", "-A"], at);
	git(["-c", `user.email=${email}`, "commit", "-q", "-m", message], at);
}

/** Configures a fresh repository the way a user's would be. */
function initRepo(at: string, email: string | null = EMAIL): void {
	git(["init", "-q", "--initial-branch=main"], at);
	if (email !== null) git(["config", "user.email", email], at);
	git(["config", "user.name", "Me"], at);
	git(["config", "commit.gpgsign", "false"], at);
}

beforeEach(async () => {
	tmp = await dir({ unsafeCleanup: true });
	cwd = fs.realpathSync(tmp.path);
	initRepo(cwd);
	write("src/a.ts", "export const a = 1;\n");
	write("src/b.ts", "export const b = 1;\n");
	commitAll("initial");
});

afterEach(async () => {
	await tmp.cleanup();
});

/** Captures a base, runs `act`, and returns what the detector observed. */
async function observe(act: () => void): Promise<TouchObservation> {
	const base = await SessionBase.capture(cwd);
	act();
	return TouchDetector.detect(cwd, base ?? undefined);
}

/** The touched paths that are still candidates. */
function paths(o: TouchObservation): string[] {
	return o.candidates.map((c) => c.path).sort();
}

describe("SessionBase.capture (REQ-IDX-19, -20)", () => {
	it("records HEAD and the hash of each modified or untracked file", async () => {
		write("src/a.ts", "export const a = 2;\n");
		write("src/new.ts", "export const n = 1;\n");
		const base = await SessionBase.capture(cwd);
		expect(base?.commit).toBe(git(["rev-parse", "HEAD"]));
		expect(base?.dirty).toEqual(
			expect.arrayContaining([
				{ path: "src/a.ts", hash: contentHash("export const a = 2;\n") },
				{ path: "src/new.ts", hash: contentHash("export const n = 1;\n") },
			]),
		);
		expect(base?.dirty).toHaveLength(2);
	});

	it("records no commit in a repository with none, and null outside git", async () => {
		const fresh = await dir({ unsafeCleanup: true });
		const plain = await dir({ unsafeCleanup: true });
		try {
			initRepo(fresh.path);
			write("x.ts", "x\n", fresh.path);
			const base = await SessionBase.capture(fresh.path);
			expect(base).not.toBeNull();
			expect(base?.commit).toBeUndefined();
			expect(base?.dirty.map((d) => d.path)).toEqual(["x.ts"]);
			expect(await SessionBase.capture(plain.path)).toBeNull();
		} finally {
			await fresh.cleanup();
			await plain.cleanup();
		}
	});

	it("records no base past 200 dirty files (REQ-IDX-20)", async () => {
		for (let i = 0; i < 201; i++) write(`gen/f${String(i)}.ts`, `export const x = ${String(i)};\n`);
		expect(await SessionBase.capture(cwd)).toBeNull();
	});
});

describe("TouchDetector.detect — what touched means", () => {
	it("counts the user's own commits since the base, not another author's or a merge's (REQ-IDX-21)", async () => {
		const o = await observe(() => {
			write("src/mine.ts", "export const m = 1;\n");
			commitAll("mine");
			write("src/theirs.ts", "export const t = 1;\n");
			commitAll("theirs", "someone@else.com");
			git(["switch", "-q", "-c", "side"]);
			write("src/merged.ts", "export const g = 1;\n");
			commitAll("on side");
			git(["switch", "-q", "main"]);
			git(["-c", `user.email=${EMAIL}`, "merge", "-q", "--no-ff", "-m", "merge", "side"]);
		});
		expect(paths(o)).toEqual(["src/mine.ts"]);
		expect(o.noUserEmail).toBe(false);
	});

	it("counts no commit when user.email is unset, and says so (REQ-IDX-21)", async () => {
		git(["config", "--unset", "user.email"]);
		const o = await observe(() => {
			write("src/mine.ts", "export const m = 1;\n");
			git(["add", "-A"]);
			git(["-c", `user.email=${EMAIL}`, "commit", "-q", "-m", "mine"]);
		});
		expect(paths(o)).toEqual([]);
		expect(o.noUserEmail).toBe(true);
	});

	it("does not count a teammate's commit arriving by fast-forward pull (REQ-IDX-21)", async () => {
		const other = await dir({ unsafeCleanup: true });
		try {
			git(["clone", "-q", cwd, other.path]);
			git(["config", "user.email", "teammate@example.com"], other.path);
			git(["config", "commit.gpgsign", "false"], other.path);
			const o = await observe(() => {
				write("src/team.ts", "export const t = 1;\n", other.path);
				commitAll("team", "teammate@example.com", other.path);
				git(["pull", "-q", "--ff-only", other.path, "main"]);
			});
			expect(fs.existsSync(path.join(cwd, "src/team.ts"))).toBe(true);
			expect(paths(o)).toEqual([]);
		} finally {
			await other.cleanup();
		}
	});

	it("counts staged, unstaged and untracked work, file by file, under its new name (REQ-IDX-22)", async () => {
		const o = await observe(() => {
			write("src/a.ts", "export const a = 3;\n");
			write("src/b.ts", "export const b = 3;\n");
			git(["add", "src/b.ts"]);
			write("newdir/x.ts", "export const x = 1;\n");
			write("newdir/y.ts", "export const y = 1;\n");
			write("a b.ts", "export const s = 1;\n");
			git(["mv", "src/b.ts", "src/c.ts"]);
		});
		expect(paths(o)).toEqual(["a b.ts", "newdir/x.ts", "newdir/y.ts", "src/a.ts", "src/c.ts"]);
	});

	it("does not count work in progress the session left alone (REQ-IDX-23)", async () => {
		write("src/a.ts", "export const a = 2;\n");
		write("src/wip.ts", "export const w = 1;\n");
		const o = await observe(() => {
			write("src/wip.ts", "export const w = 2;\n");
		});
		expect(paths(o)).toEqual(["src/wip.ts"]);
		expect(o.unchangedSinceBase).toBe(1);
	});

	it("stops with a reason when there is no base, it is gone, or it is not an ancestor (REQ-IDX-24)", async () => {
		write("src/a.ts", "export const a = 9;\n");
		expect((await TouchDetector.detect(cwd, undefined)).stopped).toBe("no-base");

		// A base on a commit that no longer exists.
		write("src/tmp.ts", "export const t = 1;\n");
		commitAll("doomed");
		const doomed = await SessionBase.capture(cwd);
		git(["reset", "-q", "--hard", "HEAD~1"]);
		git(["reflog", "expire", "--expire=now", "--all"]);
		git(["gc", "-q", "--prune=now"]);
		const gone = await TouchDetector.detect(cwd, doomed ?? undefined);
		expect(gone.stopped).toBe("base-missing");
		expect(gone.candidates).toEqual([]);

		// A base HEAD is no longer descended from.
		write("src/side.ts", "export const s = 1;\n");
		commitAll("ahead");
		const ahead = await SessionBase.capture(cwd);
		git(["checkout", "-q", "-b", "other", "HEAD~1"]);
		const moved = await TouchDetector.detect(cwd, ahead ?? undefined);
		expect(moved.stopped).toBe("base-not-ancestor");
	});
});

/** A chunk with one open task. */
function chunk(id: number, files?: string[], status: "todo" | "done" = "todo"): PlanChunk {
	return {
		chunk_id: id,
		title: `Chunk ${String(id)}`,
		depends_on: [],
		tasks: [{ text: `Work on chunk ${String(id)}`, status }],
		...(files !== undefined ? { files } : {}),
	};
}

/** Runs decide with defaults a plain session would have. */
function decide(
	o: TouchObservation,
	extra: Partial<Parameters<typeof TouchTagger.decide>[0]> = {},
): ReturnType<typeof TouchTagger.decide> {
	return TouchTagger.decide({
		observation: o,
		entries: [{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "rules" }],
		chunks: [chunk(1)],
		activeChunk: 1,
		completed: [],
		toolOwned: new Set(["CLAUDE.md", ".gitignore", ".gitattributes"]),
		walked: [],
		...extra,
	});
}

describe("TouchTagger.decide — what is not tagged", () => {
	it("skips each excluded file under the first reason that applies (REQ-IDX-25..29)", async () => {
		write("src/space.ts", "export const s = 1;\n");
		write("src/revert.ts", "export const r = 1;\n");
		write("CLAUDE.md", "# rules\n");
		commitAll("more");
		const o = await observe(() => {
			// Committed in the session, then deleted or reverted in the tree.
			write("src/gone.ts", "export const g = 1;\n");
			write("src/revert.ts", "export const r = 2;\n");
			commitAll("session work");
			fs.rmSync(path.join(cwd, "src/gone.ts"));
			write("src/revert.ts", "export const r = 1;\n");

			write("src/edited.ts", "export const e = 2;\n");
			write(".session/x.md", "state\n");
			write("dist/a.js", "x\n");
			write("CLAUDE.md", "# rules, edited\n");
			write("pnpm-lock.yaml", "lockfileVersion: 9\n");
			write("img.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]));
			write(".gitattributes", "src/gen.ts linguist-generated\n");
			write("src/gen.ts", "export const g = 1;\n");
			write("src/space.ts", "export  const s = 1;\n\n\n");
			write("src/unsafe|x.ts", "export const u = 1;\n");
		});
		const d = decide(o);
		expect([...d.tags.keys()]).toEqual(["src/edited.ts"]);
		expect(Object.fromEntries(d.skipped)).toEqual({
			// .session/x.md, dist/a.js, CLAUDE.md, .gitattributes, src/gone.ts
			"excluded-path": 5,
			"unsafe-path": 1,
			lockfile: 1,
			"binary-or-generated": 2,
			// src/space.ts, and src/revert.ts edited back to what the base had
			"whitespace-only": 2,
		});
	});

	it("tags 20 survivors and none of 21 (REQ-IDX-30)", async () => {
		const many = (n: number) => () => {
			for (let i = 0; i < n; i++) write(`src/m${String(i)}.ts`, `export const m = ${String(i)};\n`);
		};
		const twenty = decide(await observe(many(20)));
		expect(twenty.tags.size).toBe(20);
		for (let i = 0; i < 21; i++) fs.rmSync(path.join(cwd, `src/m${String(i)}.ts`), { force: true });
		const o21 = await observe(many(21));
		const d21 = decide(o21);
		expect(d21.tags.size).toBe(0);
		expect(d21.skipped.get("too-many")).toBe(21);
	});

	it("tags nothing when every task of the active chunk is done (REQ-IDX-31)", async () => {
		const o = await observe(() => write("src/a.ts", "export const a = 5;\n"));
		const d = decide(o, { chunks: [chunk(1, undefined, "done")] });
		expect(d.tags.size).toBe(0);
		expect(d.skipped.get("chunk-done")).toBe(1);
	});

	it("drops a path git reports with a backtick, a pipe or a space (REQ-IDX-26)", async () => {
		const o = await observe(() => {
			write("src/a`b.ts", "x\n");
			write("src/a|b.ts", "x\n");
			write("src/a b.ts", "x\n");
		});
		const d = decide(o);
		expect(d.tags.size).toBe(0);
		expect(d.skipped.get("unsafe-path")).toBe(3);
	});
});

describe("TouchTagger.decide — which chunk (REQ-IDX-32, -33)", () => {
	it("tags to the active chunk, and to an open chunk that names the file", async () => {
		const o = await observe(() => {
			write("src/a.ts", "export const a = 7;\n");
			write("src/b.ts", "export const b = 7;\n");
			write("src/shared/util.ts", "x\n");
			write("lib/shared/util.ts", "x\n");
		});
		const d = decide(o, {
			activeChunk: 2,
			chunks: [
				chunk(2),
				chunk(5, ["src/b.ts", "util.ts"]),
				chunk(6, ["src/a.ts"]),
				chunk(7, ["src/a.ts"], "done"),
			],
			completed: [6],
			walked: ["src/a.ts", "src/b.ts", "src/shared/util.ts", "lib/shared/util.ts"],
		});
		expect(d.tags.get("src/a.ts")).toEqual([2]);
		expect(d.tags.get("src/b.ts")).toEqual([2, 5]);
		// A basename two walked files share names neither.
		expect(d.tags.get("src/shared/util.ts")).toEqual([2]);
		expect(d.tags.get("lib/shared/util.ts")).toEqual([2]);
	});
});
