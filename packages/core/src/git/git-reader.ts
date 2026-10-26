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

/** One `git status` entry: its two-letter code and the path it now has. */
export interface StatusEntry {
	/** Porcelain v1 `XY` code, e.g. ` M`, `A `, `??`, `R `. */
	readonly code: string;
	/** Repo-relative path, unquoted. For a rename, the new path. */
	readonly path: string;
	/** For a rename or copy, the old path. */
	readonly from?: string;
}

/** What a path's diff against a base amounts to. */
export type DiffKind = "changed" | "blank" | "binary";

/** Arguments per `check-attr` call, to stay under the command-line limit. */
const ATTR_BATCH = 200;

/**
 * Splits NUL-separated git output into records.
 *
 * @param out - Raw `-z` output, or `null`.
 * @returns The records, without the empty one after the final NUL.
 */
function records(out: string | null): string[] {
	if (out === null || out.length === 0) return [];
	const parts = out.split("\0");
	if (parts[parts.length - 1] === "") parts.pop();
	return parts;
}

/**
 * Parses `status --porcelain=v1 -z` output (REQ-IDX-22). A rename or copy
 * is followed by a second record holding the old path.
 *
 * @param out - Raw output, or `null`.
 * @returns One entry per path.
 */
function parseStatusZ(out: string | null): StatusEntry[] {
	const recs = records(out);
	const entries: StatusEntry[] = [];
	for (let i = 0; i < recs.length; i++) {
		const rec = recs[i] ?? "";
		if (rec.length < 4) continue;
		const code = rec.slice(0, 2);
		const entry: StatusEntry = { code, path: rec.slice(3) };
		if (code.includes("R") || code.includes("C")) {
			i++;
			const from = recs[i];
			entries.push(from !== undefined ? { ...entry, from } : entry);
		} else {
			entries.push(entry);
		}
	}
	return entries;
}

/**
 * Parses `diff --numstat -z --no-renames` output.
 *
 * @param out - Raw output, or `null`.
 * @returns Path → kind, for every path git reported.
 */
function parseNumstatZ(out: string | null): Map<string, DiffKind> {
	const map = new Map<string, DiffKind>();
	for (const rec of records(out)) {
		const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(rec);
		if (m === null || m[3] === undefined) continue;
		if (m[1] === "-") map.set(m[3], "binary");
		else map.set(m[3], m[1] === "0" && m[2] === "0" ? "blank" : "changed");
	}
	return map;
}

/**
 * Id of the empty tree in this repository's hash format, so SHA-256
 * repositories work as well as SHA-1 ones.
 *
 * @param cwd - Repository working directory.
 * @returns The tree id, or `null` if git cannot compute it.
 */
async function emptyTree(cwd: string): Promise<string | null> {
	const out = await git(cwd, ["hash-object", "-t", "tree", "/dev/null"]);
	return out !== null && /^[0-9a-f]{40,64}$/.test(out) ? out : null;
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

	/**
	 * Resolves `HEAD` to a full commit id.
	 *
	 * @param cwd - Repository working directory.
	 * @returns The commit id, or `null` in a repository with no commits.
	 */
	async head(cwd: string): Promise<string | null> {
		const out = await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
		return out !== null && out.length > 0 ? out : null;
	},

	/**
	 * Reads the configured `user.email`. Compared, never stored.
	 *
	 * @param cwd - Repository working directory.
	 * @returns The email, or `null` when unset.
	 */
	async userEmail(cwd: string): Promise<string | null> {
		const out = await git(cwd, ["config", "user.email"]);
		return out !== null && out.length > 0 ? out : null;
	},

	/**
	 * Checks whether a commit still exists in the object store.
	 *
	 * @param cwd - Repository working directory.
	 * @param sha - The commit id.
	 * @returns `true` when the commit exists.
	 * @throws {CliError} If the id fails the safety check.
	 */
	async commitExists(cwd: string, sha: string): Promise<boolean> {
		return (await git(cwd, ["cat-file", "-e", `${assertSafeRev(sha)}^{commit}`])) !== null;
	},

	/**
	 * Checks whether `ancestor` is an ancestor of (or equal to) `descendant`.
	 *
	 * @param cwd - Repository working directory.
	 * @param ancestor - The would-be ancestor.
	 * @param descendant - The would-be descendant.
	 * @returns `true` when it is.
	 * @throws {CliError} If either revision fails the safety check.
	 */
	async isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
		const args = [
			"merge-base",
			"--is-ancestor",
			assertSafeRev(ancestor),
			assertSafeRev(descendant),
		];
		return (await git(cwd, args)) !== null;
	},

	/**
	 * Lists working-tree changes against `HEAD`: staged, unstaged and
	 * untracked, every file inside a new directory, paths unquoted, renames
	 * under their new path (REQ-IDX-22).
	 *
	 * @param cwd - Repository working directory.
	 * @returns One entry per changed path; empty outside git.
	 */
	async statusEntries(cwd: string): Promise<StatusEntry[]> {
		return parseStatusZ(
			await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
		);
	},

	/**
	 * Lists files that commits on `HEAD`'s first-parent line since `base`,
	 * excluding merges and authored by `email`, added, modified or renamed to
	 * their present path (REQ-IDX-21).
	 *
	 * @param cwd - Repository working directory.
	 * @param base - The base commit, or `null` for every commit on `HEAD`.
	 * @param email - Author email to keep; compared case-insensitively.
	 * @returns Repo-relative paths, unique, in first-seen order.
	 * @throws {CliError} If `base` fails the safety check.
	 */
	async committedBy(cwd: string, base: string | null, email: string): Promise<string[]> {
		const range = base === null ? "HEAD" : `${assertSafeRev(base)}..HEAD`;
		const log = await git(cwd, [
			"log",
			"--first-parent",
			"--no-merges",
			"--format=%H%x09%ae",
			range,
		]);
		const want = email.toLowerCase();
		const shas = lines(log).flatMap((l) => {
			const [sha, author] = l.split("\t");
			return sha !== undefined && author?.toLowerCase() === want ? [sha] : [];
		});
		const seen = new Set<string>();
		for (const sha of shas) {
			const out = await git(cwd, [
				...["diff-tree", "--root", "--no-commit-id", "-r", "-z", "-M"],
				...["--name-only", "--diff-filter=ACMR", assertSafeRev(sha)],
			]);
			for (const p of records(out)) seen.add(p);
		}
		return [...seen];
	},

	/**
	 * Says, per tracked path, whether its working-tree content differs from
	 * `base` in anything but whitespace and blank lines (REQ-IDX-28, -29).
	 *
	 * Untracked files are not compared; git reports nothing for them.
	 *
	 * @param cwd - Repository working directory.
	 * @param base - The base commit, or `null` to compare with the empty tree.
	 * @param paths - Paths to ask about.
	 * @returns Path → kind; a path absent from the map does not differ at all.
	 * @throws {CliError} If `base` fails the safety check.
	 */
	async substantive(
		cwd: string,
		base: string | null,
		paths: readonly string[],
	): Promise<Map<string, DiffKind>> {
		if (paths.length === 0) return new Map();
		const from = base === null ? await emptyTree(cwd) : assertSafeRev(base);
		if (from === null) return new Map();
		const args = ["diff", "--numstat", "-z", "--no-renames", "-w", "--ignore-blank-lines", from];
		return parseNumstatZ(await git(cwd, [...args, "--", ...paths]));
	},

	/**
	 * Lists the paths a git attribute is set on, e.g. `linguist-generated`
	 * (REQ-IDX-28). Reads the user's own `.gitattributes`; guesses nothing.
	 *
	 * @param cwd - Repository working directory.
	 * @param paths - Paths to ask about.
	 * @param attr - The attribute name.
	 * @returns The paths whose attribute is `set` or `true`.
	 */
	async attribute(cwd: string, paths: readonly string[], attr: string): Promise<Set<string>> {
		const set = new Set<string>();
		for (let i = 0; i < paths.length; i += ATTR_BATCH) {
			const batch = paths.slice(i, i + ATTR_BATCH);
			const recs = records(await git(cwd, ["check-attr", "-z", attr, "--", ...batch]));
			for (let j = 0; j + 2 < recs.length; j += 3) {
				const value = recs[j + 2];
				const p = recs[j];
				if (p !== undefined && (value === "set" || value === "true")) set.add(p);
			}
		}
		return set;
	},
} as const;
