/**
 * Pure savings arithmetic and file classification for the benchmark
 * (LLD-eval-harness.md, REQ-EVAL-15..17).
 *
 * Kept free of imports so it is testable without a build.
 */

import type { SavingsReport } from "./types.js";

/** Package-manager lockfiles: generated, never loaded by a developer. */
const LOCKFILES = new Set([
	"pnpm-lock.yaml",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"bun.lockb",
	"bun.lock",
	"Cargo.lock",
	"poetry.lock",
	"Gemfile.lock",
	"composer.lock",
	"go.sum",
]);

/**
 * Whether a path is a package-manager lockfile.
 *
 * @param relPath - Repo-relative path.
 * @returns True for a lockfile at any depth.
 */
export function isLockfile(relPath: string): boolean {
	const base = relPath.split(/[/\\]/).pop() ?? relPath;
	return LOCKFILES.has(base);
}

/**
 * Whether a path is the project plan a developer would read first.
 *
 * @param relPath - Repo-relative path.
 * @returns True for `PLAN.md` / `PLAN_N.md` at the root or under `docs/`.
 */
export function isPlanFile(relPath: string): boolean {
	const parts = relPath.split(/[/\\]/);
	const name = parts.pop() ?? "";
	const dir = parts.join("/");
	return (dir === "" || dir === "docs") && /^PLAN(_\d+)?\.md$/i.test(name);
}

/**
 * Savings between the without-tool baseline and the with-tool context.
 *
 * A context that names no files is not a compressed context, it is an empty
 * one — reporting it as "620× smaller" rewards the tool for doing nothing.
 *
 * @param withoutTokens - Baseline tokens.
 * @param withTokens - With-tool context tokens.
 * @param withFileCount - Files the with-tool context names.
 * @returns The savings report; `applicable` is false for an empty context.
 */
export function computeSavings(
	withoutTokens: number,
	withTokens: number,
	withFileCount: number,
): SavingsReport {
	const tokensSaved = withoutTokens - withTokens;
	if (withFileCount === 0) {
		return { tokensSaved, percentSaved: 0, ratio: "n/a", applicable: false };
	}
	const percentSaved = withoutTokens > 0 ? (tokensSaved / withoutTokens) * 100 : 0;
	const ratioNum = withTokens > 0 ? withoutTokens / withTokens : 0;
	return { tokensSaved, percentSaved, ratio: `${ratioNum.toFixed(1)}×`, applicable: true };
}
