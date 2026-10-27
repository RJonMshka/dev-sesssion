/**
 * The Claude Code plan skill (LLD-plan-authoring.md, REQ-PLA-9..14).
 *
 * One skill, two sections: how to write a plan this tool reads well, and how
 * to drive the chunk loop from outside. A skill costs its description in every
 * session and its body only when it triggers, which is why this lives here and
 * not in the `CLAUDE.md` block.
 *
 * Tests run the generated text, never a copy of it: the example plan goes
 * through `checkPlan` (REQ-PLA-11) and every command through the real CLI
 * program (REQ-PLA-12).
 *
 * @packageDocumentation
 */

import {
	type AdapterReadFile,
	type AdapterWriteFile,
	CHUNK_HEADING_SHAPE,
	INIT_WITH_PLAN_COMMAND,
	PLAN_CHECK_COMMAND,
} from "@dev-session/core";

/** Where the skill is written, relative to the project root. */
export const PLAN_SKILL_PATH = ".claude/skills/dev-sesssion/SKILL.md";

/** The skill's `description` — paid for in every session (REQ-PLA-9). */
export const PLAN_SKILL_DESCRIPTION =
	"Write a multi-session plan that dev-sesssion splits into chunks, check it, and run the chunks one fresh session at a time. Use when asked to plan work across sessions, write or fix a plan file, or run a plan's chunks.";

/** Matches the managed marker and captures its version. */
const MARKER_RE = /^<!-- dev-sesssion:managed v(\S+) -->$/m;

/**
 * The managed marker: the body's first line. A file without it belongs to the
 * user and is never touched (REQ-PLA-13).
 *
 * @param version - The CLI version writing the file.
 * @returns The marker line.
 */
export function planSkillMarker(version: string): string {
	return `<!-- dev-sesssion:managed v${version} -->`;
}

/** The example plan. Kept in one place so the test reads what the skill shows. */
const EXAMPLE_PLAN = `# Plan: invoices

## Chunk 1 — Invoice model

Goal: store invoices so later chunks can bill them.

1. Add the \`Invoice\` type and its repository
2. Cover both with unit tests

Files: \`src/models/invoice.ts\`, \`src/db/invoice-repo.ts\`

- [ ] Define Invoice in src/models/invoice.ts
- [ ] Add create and findById to src/db/invoice-repo.ts
- [ ] Unit tests for both

## Chunk 2 — Billing endpoint

Depends on: Chunk 1

Goal: POST /invoices/:id/bill charges the customer once.

1. Add the route and an idempotency check
2. Call the payment client

Files: \`src/routes/billing.ts\`, \`src/payments/client.ts\`

- [ ] Route in src/routes/billing.ts
- [ ] Reject a second bill for the same invoice
- [ ] Integration test`;

/**
 * Renders the skill file: frontmatter, marker, body.
 *
 * @param version - The CLI version, written into the marker.
 * @returns The whole `SKILL.md`.
 */
export function renderPlanSkill(version: string): string {
	return `---
name: dev-sesssion
description: ${PLAN_SKILL_DESCRIPTION}
---
${planSkillMarker(version)}
# Plans and the chunk loop

This project's session tool splits a plan into chunks, one session's work
each, and writes a prompt that loads only that chunk's files.

## Writing a plan

Never overwrite an existing \`PLAN.md\`; it may be a spec or a roadmap someone
keeps. Write \`docs/dev-sesssion-plan.md\` unless the user names another file.

Give each chunk a \`${CHUNK_HEADING_SHAPE}\` heading, then a one-line goal,
numbered steps, a \`Files:\` line of backticked paths, and \`- [ ]\` tasks:

\`\`\`markdown
${EXAMPLE_PLAN}
\`\`\`

Rules:

- One chunk is one session's work: a goal, a few steps, two to six tasks.
- Number chunks 1, 2, 3. To fit work between 2 and 3 later, use 2.5.
- Every task sits under a numbered chunk heading. A section with no number is
  dropped, tasks and all.
- Name the files each chunk touches, including ones it will create. The prompt
  loads files that exist and the neighbours of ones that don't yet.
- Add \`Depends on: Chunk N\` when order matters.

Then check it, and fix the plan until \`ok\` is true:

1. \`${PLAN_CHECK_COMMAND} <file> --json\`
2. Read \`excluded\` (sections that would be dropped) and \`warnings\`
   (dependencies on chunks that don't exist). Each chunk should show
   \`hasBrief: true\` and some \`namedPaths\`.
3. \`${INIT_WITH_PLAN_COMMAND} <file> -y\`

## Running the loop

When asked to run the plan, you orchestrate: you never do a chunk's work
yourself. Doing every chunk in one conversation fills the context this tool
exists to keep small.

Repeat:

1. \`dev-sesssion status --json\` gives \`active_chunk\`.
2. \`dev-sesssion prompt\` prints the chunk's prompt. Give it, unchanged, to a
   fresh subagent or session. It does the work and marks tasks done as the
   prompt says.
3. \`dev-sesssion advance --json\` moves on. Stop when \`allChunksComplete\` is
   true.

If \`advance\` exits non-zero, the chunk still has open tasks. Send it back to a
subagent, or ask the user before passing \`--yes\`, which advances past them.

Read only the JSON. Don't open chunk files or the session directory yourself.
`;
}

/** What happened to the skill file. */
export type PlanSkillOutcome =
	| "created"
	| "replaced"
	| "unchanged"
	| "skipped-user-file"
	| "absent";

/** Options for {@link syncPlanSkill}. */
export interface SyncPlanSkillOptions {
	/** The CLI version, for the marker. */
	readonly version: string;
	/** Create the file when it does not exist (init does; update does not). */
	readonly create: boolean;
}

/**
 * Writes the skill, respecting ownership: a file without the managed marker is
 * the user's and is left alone (REQ-PLA-13); a managed file from any other
 * version is replaced (REQ-PLA-14).
 *
 * @param io - The adapter's reader and writer (AtomicWriter + WriteGuard).
 * @param options - Version and whether a missing file is created.
 * @returns What happened.
 * @throws {SecurityError} If the writer refuses the path or content.
 */
export function syncPlanSkill(
	io: { readonly readFile: AdapterReadFile; readonly writeFile: AdapterWriteFile },
	options: SyncPlanSkillOptions,
): PlanSkillOutcome {
	const existing = io.readFile(PLAN_SKILL_PATH);
	const next = renderPlanSkill(options.version);
	if (existing === undefined) {
		if (!options.create) return "absent";
		io.writeFile(PLAN_SKILL_PATH, next);
		return "created";
	}
	if (!MARKER_RE.test(existing)) return "skipped-user-file";
	if (existing === next) return "unchanged";
	io.writeFile(PLAN_SKILL_PATH, next);
	return "replaced";
}

/**
 * One line for the CLI to show, or undefined when there is nothing to say.
 *
 * @param outcome - What {@link syncPlanSkill} did.
 * @returns A sentence naming the file.
 */
export function describePlanSkillOutcome(outcome: PlanSkillOutcome): string | undefined {
	switch (outcome) {
		case "created":
			return `Wrote the plan skill to ${PLAN_SKILL_PATH}`;
		case "replaced":
			return `Updated the plan skill at ${PLAN_SKILL_PATH}`;
		case "skipped-user-file":
			return `Skipped ${PLAN_SKILL_PATH}: it has no dev-sesssion marker, so it is yours and was left unchanged`;
		default:
			return undefined;
	}
}
