/**
 * Generates and writes ROUTINES.md — how a session runs, in the same words the
 * adapters' managed blocks use (LLD-task-done.md, REQ-TASK-14).
 *
 * This is a static file with well-known content. It is written once during
 * `dev-sesssion init` and rarely changes.
 *
 * @packageDocumentation
 */

import * as path from "node:path";

import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter } from "@dev-session/security";

import { sessionLoopLines } from "../adapters/session-loop.js";

/** The filename for the routines file within the session directory. */
const ROUTINES_FILENAME = "ROUTINES.md";

/**
 * Builds the static ROUTINES.md content string.
 *
 * @returns The full markdown content for ROUTINES.md.
 */
function buildRoutinesContent(): string {
	return [
		"# Routines",
		"",
		"How a coding session runs with dev-sesssion. The same steps are in the",
		"dev-sesssion block of your agent's instructions file (CLAUDE.md, AGENTS.md,",
		".cursorrules or .windsurfrules), which the agent reads on its own.",
		"",
		// The same lines every adapter writes (REQ-TASK-14).
		...sessionLoopLines(".session", "markdown").flatMap((line) => [`- ${line}`]),
		"",
		"When every task in the chunk is done, `npx dev-sesssion advance` moves to the next one.",
		"",
	].join("\n");
}

/**
 * Writes ROUTINES.md with bootstrap and self-update prompt snippets.
 */
export const RoutinesWriter = {
	/**
	 * Writes ROUTINES.md to the session directory.
	 *
	 * @param sessionDir - A validated path to the `.session/` directory.
	 */
	write(sessionDir: ValidatedPath): void {
		const filePath = path.join(sessionDir, ROUTINES_FILENAME) as ValidatedPath;
		const content = buildRoutinesContent();
		AtomicWriter.writeFile(filePath, content);
	},
} as const;
