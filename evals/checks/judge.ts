/**
 * Rubric judge for cold-agent output.
 *
 * Scores one dimension per call rather than emitting several numbers in one
 * response: bundled scores correlate and collapse toward a single impression.
 * Every judgment is anchored to the deleted file (ground truth) and the written
 * behavioural contract, so the judge compares against a reference instead of
 * forming a free-floating opinion.
 *
 * @module
 */

import Anthropic from "@anthropic-ai/sdk";

/** Judge model. */
const JUDGE_MODEL = "claude-opus-5";

/** A single scored dimension. */
export interface DimensionScore {
	readonly dimension: string;
	/** 1-5, anchored by the rubric in the prompt. */
	readonly score: number;
	readonly justification: string;
}

/** A dimension scored twice, with an agreement flag. */
export interface ReliableScore extends DimensionScore {
	readonly secondScore: number;
	/** True when the two runs differ by more than one point — treat as unreliable. */
	readonly unstable: boolean;
}

/** Rubric dimensions applied to a restored file. */
const DIMENSIONS: readonly { readonly name: string; readonly rubric: string }[] = [
	{
		name: "contract_satisfaction",
		rubric:
			"Does the candidate satisfy every clause of the stated behavioural contract? " +
			"5 = every clause satisfied, including error codes and edge cases. " +
			"3 = the main path works but a clause is missed or weakened. " +
			"1 = the contract is substantially unmet.",
	},
	{
		name: "convention_match",
		rubric:
			"Does the candidate match the reference's conventions — import style, error type, " +
			"export shape, naming? 5 = indistinguishable in style from the reference. " +
			"3 = works but diverges noticeably. 1 = foreign to the codebase.",
	},
	{
		name: "no_fabrication",
		rubric:
			"Does the candidate avoid inventing project APIs, modules, or helpers that do not exist? " +
			"A module the agent created itself in this same run is NOT invented — the supporting " +
			"files and the project file listing below are authoritative, so check them before " +
			"calling any import fabricated. " +
			"5 = every referenced symbol exists in the project or was created in this run. " +
			"3 = one questionable reference. 1 = depends on project code that does not exist.",
	},
];

/** JSON schema constraining the judge's reply. */
const SCORE_SCHEMA = {
	type: "object",
	properties: {
		// The API rejects `minimum`/`maximum` on integer in structured-output
		// schemas; an enum constrains the range and is accepted.
		score: { type: "integer", enum: [1, 2, 3, 4, 5] },
		justification: { type: "string" },
	},
	required: ["score", "justification"],
	additionalProperties: false,
} as const;

/**
 * Issues one scoring call.
 *
 * @param client - Anthropic client.
 * @param prompt - Fully rendered judging prompt.
 * @returns The parsed score and justification.
 * @throws {Error} If the response contains no parseable JSON.
 */
async function scoreOnce(
	client: Anthropic,
	prompt: string,
): Promise<{ score: number; justification: string }> {
	const res = await client.messages.create({
		model: JUDGE_MODEL,
		max_tokens: 4000,
		thinking: { type: "adaptive" },
		output_config: {
			effort: "high",
			format: { type: "json_schema", schema: SCORE_SCHEMA },
		},
		system:
			"You are grading a candidate implementation against a known-good reference. " +
			"Judge only the stated dimension. Be strict and specific; cite concrete differences.",
		messages: [{ role: "user", content: prompt }],
	});

	for (const block of res.content) {
		if (block.type === "text") {
			const parsed = JSON.parse(block.text) as { score: number; justification: string };
			if (!Number.isInteger(parsed.score) || parsed.score < 1 || parsed.score > 5) {
				throw new Error(`judge returned an out-of-range score: ${String(parsed.score)}`);
			}
			return parsed;
		}
	}
	throw new Error("judge returned no text block");
}

/**
 * Scores a candidate file against its reference on every rubric dimension.
 *
 * Each dimension is scored twice; a spread greater than one point marks the
 * dimension unstable, which is the harness's reliability check on itself.
 *
 * @param opts - Contract, reference implementation, and candidate.
 * @returns One reliable score per dimension.
 */
export async function judgeRestoration(opts: {
	readonly contract: string;
	readonly reference: string;
	readonly candidate: string | null;
	/** Other files the agent wrote this run, keyed by repo-relative path. */
	readonly supportingFiles: ReadonlyMap<string, string>;
	/** Every file present in the workspace after the run. */
	readonly projectFiles: readonly string[];
}): Promise<ReliableScore[]> {
	const client = new Anthropic();

	// A missing file is a floor score — no need to spend judge calls on it.
	if (opts.candidate === null) {
		return DIMENSIONS.map((d) => ({
			dimension: d.name,
			score: 1,
			secondScore: 1,
			unstable: false,
			justification: "The agent never produced the file.",
		}));
	}

	const supporting =
		opts.supportingFiles.size === 0
			? "(none — the agent wrote only the candidate file)"
			: [...opts.supportingFiles]
					.map(([p, c]) => `## ${p}\n\`\`\`typescript\n${c}\n\`\`\``)
					.join("\n\n");

	const out: ReliableScore[] = [];
	for (const dim of DIMENSIONS) {
		const prompt = [
			`# Dimension\n${dim.name}\n\n## Rubric\n${dim.rubric}`,
			`# Behavioural contract\n${opts.contract}`,
			`# Reference implementation (known good)\n\`\`\`typescript\n${opts.reference}\n\`\`\``,
			`# Candidate implementation\n\`\`\`typescript\n${opts.candidate}\n\`\`\``,
			`# Other files the agent created in this same run\n${supporting}`,
			`# Files present in the project after the run\n${opts.projectFiles.join("\n")}`,
			"Return JSON with `score` (1-5) and `justification`.",
		].join("\n\n");

		const [a, b] = await Promise.all([scoreOnce(client, prompt), scoreOnce(client, prompt)]);
		out.push({
			dimension: dim.name,
			score: a.score,
			secondScore: b.score,
			unstable: Math.abs(a.score - b.score) > 1,
			justification: a.justification,
		});
	}
	return out;
}
