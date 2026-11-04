/**
 * The session instructions every adapter's managed block and `ROUTINES.md`
 * carry (LLD-task-done.md, REQ-TASK-9..14). One source, so the four adapters
 * and the routines file cannot tell an agent different things.
 *
 * @packageDocumentation
 */

/** How the lines are marked up: Markdown for `CLAUDE.md`/`AGENTS.md`, plain for rules files. */
export type SessionLoopStyle = "markdown" | "plain";

/** How every command is written, so it works without the CLI on `PATH` (REQ-TASK-13). */
export const CLI_COMMAND = "npx dev-sesssion";

/**
 * The start, per-task and end steps of a session, one line each.
 *
 * @param sessionDir - The session directory as the agent sees it, e.g. `.session`.
 * @param style - Markup for the file the lines go into.
 * @returns The lines, without blank separators.
 */
export function sessionLoopLines(sessionDir: string, style: SessionLoopStyle): readonly string[] {
	const md = style === "markdown";
	const code = (s: string): string => (md ? `\`${s}\`` : s);
	const label = (s: string): string => (md ? `**${s}:**` : `${s}:`);
	return [
		`${label("Start")} Work from ${code(`${sessionDir}/NEXT_PROMPT.md`)} (${code(`${CLI_COMMAND} prompt`)} prints it). It names the active chunk, the files to load, and the tasks in order.`,
		`${label("Each task")} When a task is finished, run ${code(`${CLI_COMMAND} task done <n>`)} with its number, or a word only that task contains.`,
		`${label("End")} Run ${code(`${CLI_COMMAND} update --yes`)}. It records the files you changed and writes the next session's prompt. Moving to the next chunk is the owner's call.`,
		`${label("Never")} Edit files in ${code(`${sessionDir}/`)} by hand; the commands keep them valid. If you cannot run commands, leave ${code(`${sessionDir}/`)} as it is and list the tasks you finished.`,
	];
}
