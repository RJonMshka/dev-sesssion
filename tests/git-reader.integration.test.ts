import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { type DirectoryResult, dir } from "tmp-promise";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitReader } from "../packages/core/src/git/git-reader.js";

/**
 * Exercises GitReader against a real repository.
 *
 * The porcelain parsing here is not incidental: `git status --short` prefixes
 * unstaged changes with a leading space, and trimming it shifts every path by
 * one character. That bug is invisible to a mocked reader, so these tests use
 * real git.
 */
describe("GitReader (real repository)", () => {
	let tmp: DirectoryResult;
	let cwd: string;

	/**
	 * Runs a git command in the fixture repository.
	 *
	 * @param args - Arguments passed to git.
	 */
	function git(args: string[]): void {
		execFileSync("git", args, { cwd, stdio: "ignore" });
	}

	beforeEach(async () => {
		tmp = await dir({ unsafeCleanup: true });
		cwd = tmp.path;
		git(["init", "--initial-branch=main"]);
		git(["config", "user.email", "test@example.com"]);
		git(["config", "user.name", "Test"]);
		fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# rules\n");
		fs.mkdirSync(path.join(cwd, "src"));
		fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 1;\n");
		git(["add", "."]);
		git(["commit", "-m", "initial"]);
	});

	afterEach(async () => {
		await tmp.cleanup();
	});

	it("detects a git work tree", async () => {
		expect(await GitReader.isRepo(cwd)).toBe(true);
	});

	it("reports a non-repository as such instead of throwing", async () => {
		const plain = await dir({ unsafeCleanup: true });
		try {
			expect(await GitReader.isRepo(plain.path)).toBe(false);
		} finally {
			await plain.cleanup();
		}
	});

	it("preserves the first path in porcelain output", async () => {
		// The first line carries the leading status space that a naive trim eats.
		fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# rules v2\n");
		fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 2;\n");

		const dirty = await GitReader.dirtyFiles(cwd);
		expect(dirty).toContain("CLAUDE.md");
		expect(dirty).toContain("src/a.ts");
		expect(dirty.some((f) => f.startsWith("LAUDE"))).toBe(false);
	});

	it("includes untracked files as dirty", async () => {
		fs.writeFileSync(path.join(cwd, "new.ts"), "export const n = 1;\n");
		expect(await GitReader.dirtyFiles(cwd)).toContain("new.ts");
	});

	it("returns an empty list for a clean tree", async () => {
		expect(await GitReader.dirtyFiles(cwd)).toEqual([]);
	});

	it("distinguishes tracked from untracked paths", async () => {
		fs.writeFileSync(path.join(cwd, "untracked.ts"), "x\n");
		expect(await GitReader.isTracked(cwd, "CLAUDE.md")).toBe(true);
		expect(await GitReader.isTracked(cwd, "untracked.ts")).toBe(false);
	});

	it("reads a file as of an earlier revision", async () => {
		const first = (await GitReader.commitsTouching(cwd, "CLAUDE.md"))[0];
		fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# rules v2\n");
		git(["add", "."]);
		git(["commit", "-m", "second"]);

		expect(await GitReader.fileAtRev(cwd, first?.sha ?? "HEAD", "CLAUDE.md")).toBe("# rules");
		expect(await GitReader.fileAtRev(cwd, "HEAD", "CLAUDE.md")).toBe("# rules v2");
	});

	it("returns null for a file absent at that revision", async () => {
		expect(await GitReader.fileAtRev(cwd, "HEAD", "nope.ts")).toBeNull();
	});

	it("parses commits into sha, ISO date, and subject", async () => {
		const commits = await GitReader.commitsTouching(cwd, "CLAUDE.md");
		const commit = commits[0];
		expect(commit?.sha).toMatch(/^[0-9a-f]{40}$/);
		expect(commit?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(commit?.subject).toBe("initial");
	});

	it("lists files changed between two revisions", async () => {
		const first = (await GitReader.commitsTouching(cwd, "."))[0];
		fs.writeFileSync(path.join(cwd, "src", "b.ts"), "export const b = 1;\n");
		git(["add", "."]);
		git(["commit", "-m", "add b"]);

		expect(await GitReader.changedBetween(cwd, first?.sha ?? "HEAD", "HEAD")).toEqual(["src/b.ts"]);
	});

	it("rejects a revision containing shell metacharacters", async () => {
		await expect(GitReader.fileAtRev(cwd, "HEAD; rm -rf /", "CLAUDE.md")).rejects.toThrow(
			/Unsafe git revision/,
		);
		await expect(GitReader.changedBetween(cwd, "$(whoami)", "HEAD")).rejects.toThrow(
			/Unsafe git revision/,
		);
	});
});
