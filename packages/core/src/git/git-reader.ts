/**
 * Read-only git access for reconciling session claims against repository history.
 *
 * Every command runs through `execFile` with an argument array — never a shell
 * string — so a ref or path taken from a session file cannot inject a command.
 * Revisions are additionally shape-checked before use.
 *
 * @packageDocumentation
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliError } from "@dev-session/security";

const execFileAsync = promisify(execFile);

/** Maximum bytes of git output to buffer (large histories produce long lists). */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Characters permitted in a git revision passed to this module.
 *
 * Deliberately narrow: alphanumerics plus the punctuation used by refs, tags,
 * and range syntax. Anything else is rejected rather than escaped.
 */
const SAFE_REV_RE = /^[A-Za-z0-9._/^~@{}-]+$/;

/**
 * A single commit as read from git history.
 */
export interface GitCommit {
	/** Full commit SHA. */
	readonly sha: string;
	/** Committer date, ISO 8601. */
	readonly date: string;
	/** Subject line of the commit message. */
	readonly subject: string;
}

/**
 * Validates a git revision string before it reaches the command line.
 *
 * @param rev - The revision to check.
 * @returns The revision, unchanged, when it is safe to use.
 * @throws {CliError} If the revision contains unexpected characters.
 */
function assertSafeRev(rev: string): string {
	if (rev.length === 0 || !SAFE_REV_RE.test(rev)) {
		throw new CliError({
			message: `Unsafe git revision: "${rev}"`,
			suggestion: "Use a plain ref, tag, or SHA (letters, digits, . _ / ^ ~ @ { } -).",
		});
	}
	return rev;
}

/**
 * Runs a git command and returns its stdout.
 *
 * @param cwd - Repository working directory.
 * @param args - Argument array passed directly to git.
 * @returns Trimmed stdout, or `null` if git exited non-zero.
 */
async function git(cwd: string, args: readonly string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", args as string[], {
			cwd,
			maxBuffer: MAX_BUFFER,
		});
		// Trailing-only: porcelain status lines are column-aligned and their
		// leading space is significant, so a full trim would clip the first path.
		return stdout.replace(/\s+$/, "");
	} catch {
		return null;
	}
}

/**
 * Splits git stdout into non-empty trimmed lines.
 *
 * @param out - Raw stdout, or `null`.
 * @returns One entry per non-empty line.
 */
function lines(out: string | null): string[] {
	if (out === null) {
		return [];
	}
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

/**
 * Parses one `%H %cI %s` log line into a commit.
 *
 * A SHA and an ISO-8601 date never contain spaces, so the first two spaces
 * delimit the fields unambiguously and the remainder is the subject.
 *
 * @param line - A single formatted log line.
 * @returns The parsed commit, or `null` if the line is malformed.
 */
function parseLogLine(line: string): GitCommit | null {
	const firstSpace = line.indexOf(" ");
	if (firstSpace === -1) {
		return null;
	}
	const secondSpace = line.indexOf(" ", firstSpace + 1);
	if (secondSpace === -1) {
		return null;
	}
	return {
		sha: line.slice(0, firstSpace),
		date: line.slice(firstSpace + 1, secondSpace),
		subject: line.slice(secondSpace + 1),
	};
}

/**
 * Read-only git queries used by session verification and replay scoring.
 */
export const GitReader = {
	/**
	 * Checks whether a directory is inside a git work tree.
	 *
	 * @param cwd - Directory to test.
	 * @returns `true` when `cwd` is inside a repository.
	 */
	async isRepo(cwd: string): Promise<boolean> {
		return (await git(cwd, ["rev-parse", "--is-inside-work-tree"])) === "true";
	},

	/**
	 * Lists files modified in the working tree relative to HEAD, staged or not.
	 *
	 * @param cwd - Repository working directory.
	 * @returns Repo-relative paths with uncommitted modifications.
	 */
	async dirtyFiles(cwd: string): Promise<string[]> {
		const out = await git(cwd, ["status", "--porcelain", "--short"]);
		if (out === null) {
			return [];
		}
		// Porcelain lines must NOT be trimmed first: the status column is two
		// characters wide and its first character is a space for unstaged
		// changes, so trimming shifts the path and clips its leading character.
		return out
			.split("\n")
			.filter((line) => line.length > 3)
			.map((line) => line.slice(3).trim())
			.map((p) => {
				// Renames are reported as "old -> new"; the new path is what exists now.
				const arrow = p.indexOf(" -> ");
				return arrow === -1 ? p : p.slice(arrow + 4);
			})
			.filter((p) => p.length > 0);
	},

	/**
	 * Lists commits that touched a given path, newest first.
	 *
	 * @param cwd - Repository working directory.
	 * @param filepath - Repo-relative path to follow.
	 * @param limit - Maximum commits to return.
	 * @returns Commits touching the path, newest first.
	 */
	async commitsTouching(cwd: string, filepath: string, limit = 100): Promise<GitCommit[]> {
		const out = await git(cwd, [
			"log",
			`--max-count=${String(limit)}`,
			"--format=%H %cI %s",
			"--",
			filepath,
		]);
		return lines(out).flatMap((line) => {
			const commit = parseLogLine(line);
			return commit === null ? [] : [commit];
		});
	},

	/**
	 * Reads a file's contents as of a specific revision.
	 *
	 * @param cwd - Repository working directory.
	 * @param rev - The revision to read from.
	 * @param filepath - Repo-relative path.
	 * @returns File contents, or `null` if absent at that revision.
	 * @throws {CliError} If the revision fails the safety check.
	 */
	async fileAtRev(cwd: string, rev: string, filepath: string): Promise<string | null> {
		return await git(cwd, ["show", `${assertSafeRev(rev)}:${filepath}`]);
	},

	/**
	 * Checks whether a path is tracked by git.
	 *
	 * Replay scoring reads prompts out of history, so a prompt file that is
	 * gitignored can never be scored — this distinguishes that case from a
	 * repository that simply has no history yet.
	 *
	 * @param cwd - Repository working directory.
	 * @param filepath - Repo-relative path.
	 * @returns `true` when git tracks the path.
	 */
	async isTracked(cwd: string, filepath: string): Promise<boolean> {
		const out = await git(cwd, ["ls-files", "--error-unmatch", "--", filepath]);
		return out !== null && out.length > 0;
	},

	/**
	 * Lists files changed between two revisions.
	 *
	 * @param cwd - Repository working directory.
	 * @param from - Starting revision (exclusive).
	 * @param to - Ending revision (inclusive).
	 * @returns Repo-relative paths changed in the range.
	 * @throws {CliError} If either revision fails the safety check.
	 */
	async changedBetween(cwd: string, from: string, to: string): Promise<string[]> {
		const range = `${assertSafeRev(from)}..${assertSafeRev(to)}`;
		return lines(await git(cwd, ["diff", "--name-only", range]));
	},
} as const;
