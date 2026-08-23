/**
 * Deterministic session metrics, read from `verify --json`.
 *
 * The CLI already computes recall / precision / waste from git alone, with no
 * API key. That is ground truth and it anchors every judged score.
 *
 * @module
 */

import type { InstalledCli } from "../harness/published-cli.js";
import type { SessionMetrics } from "../types.js";

/** Shape of the `verify --json` payload this check consumes. */
interface VerifyJson {
	readonly ok?: boolean;
	readonly findings?: readonly { readonly code?: string; readonly severity?: string }[];
	readonly replay?: {
		readonly meanRecall?: number | null;
		readonly meanPrecision?: number | null;
		readonly wasteRatio?: number | null;
		readonly boundariesScored?: number;
	};
}

/**
 * Pulls the last JSON object out of mixed CLI output.
 *
 * @param stdout - Raw stdout.
 * @returns The parsed object, or null when no JSON is present.
 */
function parseJsonTail(stdout: string): VerifyJson | null {
	const start = stdout.indexOf("{");
	if (start === -1) return null;
	try {
		return JSON.parse(stdout.slice(start)) as VerifyJson;
	} catch {
		return null;
	}
}

/**
 * Runs `verify --replay --json` and normalizes the result.
 *
 * @param cli - The installed CLI.
 * @param cwd - Workspace directory.
 * @returns Normalized metrics, or null if verify produced no parseable JSON.
 */
export async function collectSessionMetrics(
	cli: InstalledCli,
	cwd: string,
): Promise<SessionMetrics | null> {
	const res = await cli.run(["verify", "--replay", "--json"], cwd);
	const json = parseJsonTail(res.stdout);
	if (json === null) return null;

	const replay = json.replay;
	return {
		verifyOk: json.ok === true,
		findings: (json.findings ?? []).map((f) => ({
			code: f.code ?? "UNKNOWN",
			severity: f.severity ?? "unknown",
		})),
		meanRecall: replay?.meanRecall ?? null,
		meanPrecision: replay?.meanPrecision ?? null,
		wasteRatio: replay?.wasteRatio ?? null,
		boundariesScored: replay?.boundariesScored ?? 0,
		// Replay needs NEXT_PROMPT.md tracked; solo mode gitignores it.
		unavailableReason:
			replay === undefined
				? "verify ran without a replay block"
				: (replay.boundariesScored ?? 0) === 0
					? "no scored session boundaries in git history"
					: null,
	};
}
