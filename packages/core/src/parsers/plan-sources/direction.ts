/**
 * What to do when there is no plan (LLD-plan-authoring.md, REQ-ORC-3).
 *
 * `init` prints this, and the Claude Code skill names the same commands, so
 * the two cannot drift apart: both read the constants below. A test resolves
 * every command here against the real CLI program (REQ-PLA-12).
 *
 * @packageDocumentation
 */

/** The places `init` looks for a plan when `--plan` is not given. */
export const DEFAULT_PLAN_PATHS: readonly string[] = ["PLAN.md", "docs/PLAN.md"];

/** Checks a plan without writing anything. Takes the file as its argument. */
export const PLAN_CHECK_COMMAND = "dev-sesssion plan check";

/** Initializes a session from a named plan file. Takes the file as its argument. */
export const INIT_WITH_PLAN_COMMAND = "dev-sesssion init --plan";

/** The heading shape every plan source scores highest. */
export const CHUNK_HEADING_SHAPE = "## Chunk N — <title>";

/** Options for {@link noPlanDirection}. */
export interface NoPlanDirectionOptions {
	/**
	 * True when init goes on to write a placeholder chunk (`--yes`), so the
	 * message says the session points at nothing real yet.
	 */
	readonly placeholder: boolean;
}

/**
 * The message `init` shows when it finds no plan: what it looked for, and how
 * to write, check and use one.
 *
 * @param options - Whether a placeholder chunk is about to be written.
 * @returns Multi-line text, no trailing newline.
 * @throws Never.
 */
export function noPlanDirection(options: NoPlanDirectionOptions): string {
	const lines = [
		`No plan found (looked for ${DEFAULT_PLAN_PATHS.join(", ")}).`,
		"  1. Write one — ask your agent to use the plan skill (.claude/skills/dev-sesssion/), or give each",
		`     unit of work a "${CHUNK_HEADING_SHAPE}" heading with "- [ ]" tasks beneath`,
		`  2. Check it:  ${PLAN_CHECK_COMMAND} <file>`,
		`  3. Use it:    ${INIT_WITH_PLAN_COMMAND} <file> -y`,
	];
	if (options.placeholder) {
		lines.push(
			"For now the session holds one placeholder chunk, not your work. Re-run step 3 to replace it.",
		);
	}
	return lines.join("\n");
}
