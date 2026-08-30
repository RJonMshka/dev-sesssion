/**
 * Rubric judge for cold-agent output.
 *
 * Two instruments, because they answer different questions.
 *
 * `compareArms` is the discriminator. Scoring each candidate in isolation on a
 * 1-5 integer scale could not tell the arms apart at all — across four measured
 * pairs it returned identical or near-identical per-dimension scores every time,
 * parking mid-scale. Comparing two candidates directly is a far easier judgement
 * than placing one on an absolute scale, so the primary signal is a forced
 * choice between them.
 *
 * `scoreAbsolute` is retained only for tracking drift across versions, which a
 * pairwise-only design cannot see: if both arms get worse together, every
 * pairwise verdict stays a tie.
 *
 * Two biases are designed against explicitly:
 * - Position bias: pairwise judges favour whichever candidate comes first, so
 *   every comparison runs in both orderings and only a verdict that survives
 *   the swap counts. A verdict that flips with order IS the tie.
 * - Arm priors: candidates are labelled "first"/"second", never "bootstrap"/
 *   "control", so the judge cannot know which condition it is grading.
 *
 * @module
 */

import Anthropic from "@anthropic-ai/sdk";

/** Judge model. */
const JUDGE_MODEL = "claude-opus-5";

/** Which arm a candidate came from. Never shown to the judge. */
export type Arm = "bootstrap" | "control";

/** One candidate under judgement. */
export interface Candidate {
	readonly arm: Arm;
	/** The restored file, or null when the agent never produced it. */
	readonly content: string | null;
	/** Other files the agent wrote this run, keyed by repo-relative path. */
	readonly supportingFiles: ReadonlyMap<string, string>;
}

/** A rubric dimension. */
interface Dimension {
	readonly name: string;
	/** What the dimension means — shared by both instruments. */
	readonly focus: string;
	/** Concrete anchors for absolute scoring. */
	readonly anchors: string;
}

const DIMENSIONS: readonly Dimension[] = [
	{
		name: "contract_satisfaction",
		focus:
			"How completely the candidate satisfies the stated behavioural contract, " +
			"clause by clause — including status codes, sentinel values, and edge cases.",
		anchors:
			"5 = every clause satisfied, edge cases included. " +
			"4 = every clause satisfied on the main path, one edge case weakened. " +
			"3 = one clause unmet. 2 = two or more clauses unmet. " +
			"1 = the contract is substantially unmet.",
	},
	{
		name: "convention_match",
		focus:
			"How closely the candidate matches the reference's conventions — import " +
			"style and specifiers, error type and how it is raised, export shape, naming.",
		anchors:
			"5 = indistinguishable in style from the reference. " +
			"4 = one cosmetic divergence. 3 = a structural divergence that still works. " +
			"2 = several divergences. 1 = foreign to the codebase.",
	},
	{
		name: "no_fabrication",
		focus:
			"Whether every project symbol the candidate references actually exists. " +
			"A module the agent created itself in this run is NOT fabricated — the " +
			"supporting files and project listing are authoritative, so check them " +
			"before calling any import invented.",
		anchors:
			"5 = every referenced symbol exists in the project or was created this run. " +
			"3 = one questionable reference. 1 = depends on project code that does not exist.",
	},
];

/** Renders a candidate's files for the prompt. */
function renderCandidate(label: string, c: Candidate): string {
	const body =
		c.content === null
			? "(the agent never produced this file)"
			: `\`\`\`typescript\n${c.content}\n\`\`\``;
	const supporting =
		c.supportingFiles.size === 0
			? "(no other files written)"
			: [...c.supportingFiles]
					.map(([p, s]) => `### ${p}\n\`\`\`typescript\n${s}\n\`\`\``)
					.join("\n\n");
	return `# Candidate ${label}\n${body}\n\n## Other files candidate ${label} wrote this run\n${supporting}`;
}

/** Shared grounding block: contract, reference, and the real project contents. */
function renderGrounding(
	contract: string,
	reference: string,
	projectFiles: readonly string[],
): string {
	return [
		`# Behavioural contract\n${contract}`,
		`# Reference implementation (known good)\n\`\`\`typescript\n${reference}\n\`\`\``,
		`# Files present in the project after the run\n${projectFiles.join("\n")}`,
	].join("\n\n");
}

// ---------------------------------------------------------------------------
// Pairwise comparison — the discriminator
// ---------------------------------------------------------------------------

/** Schema for a single pairwise verdict. */
const PAIRWISE_SCHEMA = {
	type: "object",
	properties: {
		winner: { type: "string", enum: ["first", "second", "tie"] },
		margin: { type: "string", enum: ["none", "slight", "clear", "decisive"] },
		justification: { type: "string" },
	},
	required: ["winner", "margin", "justification"],
	additionalProperties: false,
} as const;

/** One dimension's pairwise result, after the order swap. */
export interface PairwiseVerdict {
	readonly dimension: string;
	/** The arm that won both orderings, or null when the verdict did not survive the swap. */
	readonly winner: Arm | null;
	/** True when both orderings agreed. A disagreement is position bias, reported as a tie. */
	readonly orderStable: boolean;
	readonly margin: string;
	readonly justification: string;
	/** Raw per-ordering verdicts, mapped back to arms, for auditing. */
	readonly raw: readonly (Arm | "tie")[];
}

/** Issues one pairwise call and maps the verdict back to an arm. */
async function compareOnce(
	client: Anthropic,
	dim: Dimension,
	grounding: string,
	first: Candidate,
	second: Candidate,
): Promise<{ winner: Arm | "tie"; margin: string; justification: string }> {
	const prompt = [
		`# Dimension under comparison\n${dim.name}\n\n${dim.focus}`,
		grounding,
		renderCandidate("FIRST", first),
		renderCandidate("SECOND", second),
		"Which candidate is better on THIS dimension only? Answer `first`, `second`, or " +
			"`tie`. Use `tie` only when they are genuinely equivalent on this dimension — " +
			"not merely when both are imperfect. Cite the concrete difference that decided it.",
	].join("\n\n");

	const res = await client.messages.create({
		model: JUDGE_MODEL,
		max_tokens: 4000,
		thinking: { type: "adaptive" },
		output_config: { effort: "high", format: { type: "json_schema", schema: PAIRWISE_SCHEMA } },
		system:
			"You are comparing two candidate implementations against a known-good reference. " +
			"Judge only the stated dimension. Be decisive and specific: prefer a clear verdict " +
			"over a tie when any real difference exists.",
		messages: [{ role: "user", content: prompt }],
	});

	for (const block of res.content) {
		if (block.type !== "text") continue;
		const parsed = JSON.parse(block.text) as {
			winner: "first" | "second" | "tie";
			margin: string;
			justification: string;
		};
		const winner: Arm | "tie" =
			parsed.winner === "tie" ? "tie" : parsed.winner === "first" ? first.arm : second.arm;
		return { winner, margin: parsed.margin, justification: parsed.justification };
	}
	throw new Error("judge returned no text block");
}

/**
 * Compares two arms' output on every rubric dimension.
 *
 * Each dimension is judged twice with the candidates swapped. A verdict counts
 * only if it survives the swap; one that flips is position bias and is reported
 * as an unstable tie rather than a result.
 *
 * @param opts - Contract, reference, project listing, and both candidates.
 * @returns One verdict per dimension.
 */
export async function compareArms(opts: {
	readonly contract: string;
	readonly reference: string;
	readonly projectFiles: readonly string[];
	readonly bootstrap: Candidate;
	readonly control: Candidate;
}): Promise<PairwiseVerdict[]> {
	const client = new Anthropic();
	const grounding = renderGrounding(opts.contract, opts.reference, opts.projectFiles);

	const out: PairwiseVerdict[] = [];
	for (const dim of DIMENSIONS) {
		const [ab, ba] = await Promise.all([
			compareOnce(client, dim, grounding, opts.bootstrap, opts.control),
			compareOnce(client, dim, grounding, opts.control, opts.bootstrap),
		]);
		const agreed = ab.winner === ba.winner;
		out.push({
			dimension: dim.name,
			winner: agreed && ab.winner !== "tie" ? ab.winner : null,
			orderStable: agreed,
			margin: agreed ? ab.margin : "none",
			justification: ab.justification,
			raw: [ab.winner, ba.winner],
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Absolute scoring — retained for cross-version drift only
// ---------------------------------------------------------------------------

/** Schema for one absolute score. */
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

/** One absolutely-scored dimension. */
export interface DimensionScore {
	readonly dimension: string;
	readonly score: number;
	readonly justification: string;
}

/**
 * Scores one candidate against the reference on every dimension.
 *
 * Deliberately coarse and not the discriminator — use {@link compareArms} to
 * tell two arms apart. This exists so a version-over-version regression that
 * moves both arms together is still visible.
 *
 * @param opts - Contract, reference, project listing, and the candidate.
 * @returns One score per dimension.
 */
export async function scoreAbsolute(opts: {
	readonly contract: string;
	readonly reference: string;
	readonly projectFiles: readonly string[];
	readonly candidate: Candidate;
}): Promise<DimensionScore[]> {
	const client = new Anthropic();

	// A missing file is a floor score — no judge call needed.
	if (opts.candidate.content === null) {
		return DIMENSIONS.map((d) => ({
			dimension: d.name,
			score: 1,
			justification: "The agent never produced the file.",
		}));
	}

	const grounding = renderGrounding(opts.contract, opts.reference, opts.projectFiles);
	const out: DimensionScore[] = [];
	for (const dim of DIMENSIONS) {
		const prompt = [
			`# Dimension\n${dim.name}\n\n${dim.focus}\n\n## Anchors\n${dim.anchors}`,
			grounding,
			renderCandidate("UNDER REVIEW", opts.candidate),
			"Return JSON with `score` (1-5, using the anchors above) and `justification`. " +
				"Do not default to the middle of the scale — pick the anchor that actually fits.",
		].join("\n\n");

		const res = await client.messages.create({
			model: JUDGE_MODEL,
			max_tokens: 4000,
			thinking: { type: "adaptive" },
			output_config: { effort: "high", format: { type: "json_schema", schema: SCORE_SCHEMA } },
			system:
				"You are grading a candidate implementation against a known-good reference. " +
				"Judge only the stated dimension. Be strict and specific; cite concrete differences.",
			messages: [{ role: "user", content: prompt }],
		});

		let recorded = false;
		for (const block of res.content) {
			if (block.type !== "text") continue;
			const parsed = JSON.parse(block.text) as { score: number; justification: string };
			if (!Number.isInteger(parsed.score) || parsed.score < 1 || parsed.score > 5) {
				throw new Error(`judge returned an out-of-range score: ${String(parsed.score)}`);
			}
			out.push({ dimension: dim.name, score: parsed.score, justification: parsed.justification });
			recorded = true;
			break;
		}
		if (!recorded) throw new Error("judge returned no text block");
	}
	return out;
}
