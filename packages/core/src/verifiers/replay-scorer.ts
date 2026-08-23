/**
 * Scores past bootstrap prompts against what the following session actually did.
 *
 * The premise: every commit that rewrites NEXT_PROMPT.md marks a session
 * boundary. The prompt written at that boundary declares which files the next
 * session should load; the commits that follow, up to the next boundary, show
 * which files it really touched. Comparing the two turns prompt quality into a
 * measured number — precision, recall, and the share of loaded context that
 * went unused — with no model call and no API key.
 *
 * Recall is the number that matters most: a file the session needed but the
 * prompt never named is context the agent had to rediscover.
 *
 * @packageDocumentation
 */

import { FILE_LOAD_PREFIXES, LAYER_SUFFIX_RE } from "../formatters/formatter-utils.js";
import type { GitCommit, GitReader as GitReaderType } from "../git/git-reader.js";

/** Path to the bootstrap prompt, relative to the project root. */
const PROMPT_PATH = ".session/NEXT_PROMPT.md";

/** Paths excluded from scoring — bookkeeping, not the work itself. */
const IGNORED_PREFIXES: readonly string[] = [".session/", "docs/", "CHANGELOG.md"];

/**
 * The score for a single session boundary.
 */
export interface ReplayScore {
	/** SHA of the commit that wrote the prompt being scored. */
	readonly sha: string;
	/** Committer date of that commit. */
	readonly date: string;
	/** Files the prompt told the next session to load. */
	readonly declared: readonly string[];
	/** Files the following commits actually changed. */
	readonly touched: readonly string[];
	/** Declared files that were actually touched. */
	readonly hits: readonly string[];
	/** Files that were touched but never declared — context the agent had to find. */
	readonly missed: readonly string[];
	/** Declared files never touched — context loaded for nothing. */
	readonly unused: readonly string[];
	/** hits / declared. `null` when the prompt declared nothing. */
	readonly precision: number | null;
	/** hits / touched. `null` when the next session changed nothing. */
	readonly recall: number | null;
}

/**
 * Aggregate results across every scored boundary.
 */
export interface ReplayReport {
	/** Per-boundary scores, newest first. */
	readonly scores: readonly ReplayScore[];
	/** Mean precision across boundaries that had a value. */
	readonly meanPrecision: number | null;
	/** Mean recall across boundaries that had a value. */
	readonly meanRecall: number | null;
	/** Share of all declared files that went untouched — the waste ratio. */
	readonly wasteRatio: number | null;
	/** How many boundaries were found in history. */
	readonly boundariesFound: number;
	/** How many boundaries produced a usable score. */
	readonly boundariesScored: number;
	/**
	 * Why no score could be produced, when `boundariesScored` is zero.
	 * Absent when scoring succeeded.
	 */
	readonly unavailableReason?: string;
}

/**
 * Strips formatting a formatter may have applied to a file reference.
 *
 * Handles Claude-style `@` mentions, the trailing layer annotations added by
 * the layered Load section, and surrounding punctuation.
 *
 * @param raw - A single comma-separated reference from a prompt line.
 * @returns The bare path, or `null` when the token is not a path.
 */
function normalizeRef(raw: string): string | null {
	let ref = raw.trim();
	if (ref.length === 0) {
		return null;
	}

	// "+3 more" and "(none)" are summaries, not paths.
	if (ref.startsWith("+") || ref === "(none)") {
		return null;
	}

	// Drop a trailing "(layer 1)" style annotation.
	const paren = ref.indexOf(" (");
	if (paren !== -1) {
		ref = ref.slice(0, paren);
	}

	ref = ref.replace(/^@/, "").replace(/^`|`$/g, "").replace(LAYER_SUFFIX_RE, "").trim();

	// A path must look like one; prose on a Load: line should not count.
	if (!ref.includes("/") && !ref.includes(".")) {
		return null;
	}
	return ref.length > 0 ? ref : null;
}

/**
 * Extracts every file path a prompt declares.
 *
 * @param prompt - Raw NEXT_PROMPT.md content.
 * @returns Unique repo-relative paths named by the prompt.
 */
export function extractDeclaredFiles(prompt: string): string[] {
	const found = new Set<string>();

	for (const line of prompt.split("\n")) {
		const trimmed = line.trim();
		const prefix = FILE_LOAD_PREFIXES.find((p) => trimmed.startsWith(p));
		if (prefix === undefined) {
			continue;
		}

		for (const token of trimmed.slice(prefix.length).split(",")) {
			const ref = normalizeRef(token);
			if (ref !== null) {
				found.add(ref);
			}
		}
	}

	return [...found];
}

/**
 * Whether a path counts toward the score.
 *
 * @param filepath - Repo-relative path.
 * @returns `true` when the path represents real work.
 */
function isScorable(filepath: string): boolean {
	return !IGNORED_PREFIXES.some((p) => filepath.startsWith(p));
}

/**
 * Divides, returning `null` rather than `NaN` for an empty denominator.
 *
 * @param numerator - The dividend.
 * @param denominator - The divisor.
 * @returns The ratio, or `null` when there is nothing to divide by.
 */
function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

/**
 * Averages the non-null values of a list.
 *
 * @param values - Values that may individually be `null`.
 * @returns The mean of the present values, or `null` when none are present.
 */
function mean(values: readonly (number | null)[]): number | null {
	const present = values.filter((v): v is number => v !== null);
	if (present.length === 0) {
		return null;
	}
	return present.reduce((a, b) => a + b, 0) / present.length;
}

/**
 * Scores one boundary: the prompt at `commit` against the work that followed.
 *
 * @param cwd - Repository working directory.
 * @param reader - Git accessor.
 * @param commit - The commit that wrote the prompt.
 * @param nextSha - The following boundary's SHA, or `HEAD` for the newest.
 * @returns The score, or `null` when the prompt could not be read.
 */
async function scoreBoundary(
	cwd: string,
	reader: typeof GitReaderType,
	commit: GitCommit,
	nextSha: string,
): Promise<ReplayScore | null> {
	const prompt = await reader.fileAtRev(cwd, commit.sha, PROMPT_PATH);
	if (prompt === null) {
		return null;
	}

	const declared = extractDeclaredFiles(prompt).filter(isScorable);
	const touched = (await reader.changedBetween(cwd, commit.sha, nextSha)).filter(isScorable);

	const touchedSet = new Set(touched);
	const declaredSet = new Set(declared);

	const hits = declared.filter((f) => touchedSet.has(f));
	const missed = touched.filter((f) => !declaredSet.has(f));
	const unused = declared.filter((f) => !touchedSet.has(f));

	return {
		sha: commit.sha,
		date: commit.date,
		declared,
		touched,
		hits,
		missed,
		unused,
		precision: ratio(hits.length, declared.length),
		recall: ratio(hits.length, touched.length),
	};
}

/**
 * Scores historical bootstrap prompts against the work that followed them.
 */
export const ReplayScorer = {
	/**
	 * Replays session boundaries from git history and scores each one.
	 *
	 * @param cwd - Repository working directory.
	 * @param reader - Git accessor, injected so tests can supply a fake.
	 * @param limit - Maximum number of boundaries to score, newest first.
	 * @returns A {@link ReplayReport} aggregating every scored boundary.
	 */
	async run(cwd: string, reader: typeof GitReaderType, limit = 10): Promise<ReplayReport> {
		if (!(await reader.isTracked(cwd, PROMPT_PATH))) {
			return {
				scores: [],
				meanPrecision: null,
				meanRecall: null,
				wasteRatio: null,
				boundariesFound: 0,
				boundariesScored: 0,
				unavailableReason:
					`${PROMPT_PATH} is not tracked by git — replay scoring reads past prompts out of history. ` +
					"Commit it (team mode) to make session quality measurable.",
			};
		}

		const boundaries = await reader.commitsTouching(cwd, PROMPT_PATH, limit);

		const scores: ReplayScore[] = [];
		for (let i = 0; i < boundaries.length && scores.length < limit; i++) {
			const commit = boundaries[i];
			if (commit === undefined) {
				continue;
			}
			// Newest boundary is compared against the working HEAD; older ones
			// against the boundary that superseded them.
			const nextSha = i === 0 ? "HEAD" : (boundaries[i - 1]?.sha ?? "HEAD");
			const score = await scoreBoundary(cwd, reader, commit, nextSha);
			if (score !== null) {
				scores.push(score);
			}
		}

		const totalDeclared = scores.reduce((sum, s) => sum + s.declared.length, 0);
		const totalUnused = scores.reduce((sum, s) => sum + s.unused.length, 0);

		return {
			scores,
			meanPrecision: mean(scores.map((s) => s.precision)),
			meanRecall: mean(scores.map((s) => s.recall)),
			wasteRatio: ratio(totalUnused, totalDeclared),
			boundariesFound: boundaries.length,
			boundariesScored: scores.length,
		};
	},
} as const;
