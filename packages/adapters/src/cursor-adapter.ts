/**
 * Cursor adapter — full lifecycle adapter for Cursor integration.
 *
 * Wraps {@link CursorBootstrapFormatter} with lifecycle hooks that:
 * - Generate a dev-session section in .cursorrules during init
 * - Update .cursorrules session section on session end
 *
 * @packageDocumentation
 */

import type {
	Adapter,
	AdapterConfig,
	AdapterSetupContext,
	AdapterSetupResult,
	SessionLifecycleContext,
	SessionState,
	TransformStateContext,
} from "@dev-session/core";
import { CursorBootstrapFormatter } from "./cursor-bootstrap-formatter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Marker comments that delimit the dev-session section in .cursorrules. */
const SECTION_START = "# dev-session:start";
const SECTION_END = "# dev-session:end";

/** The .cursorrules file path. */
const CURSORRULES_PATH = ".cursorrules";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Static metadata for the Cursor adapter. */
const CURSOR_CONFIG: AdapterConfig = {
	name: "cursor",
	display_name: "Cursor",
	detect_files: [".cursor", ".cursorrules"],
	output_files: [".cursorrules"],
	config_version: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates the dev-session section content for .cursorrules.
 *
 * Uses comment-style markers (# prefix) since .cursorrules is plain text,
 * not markdown.
 *
 * @param projectName - The project name.
 * @param sessionDir - Relative path to the session directory.
 * @returns The section content (without markers).
 */
function generateSessionSection(_projectName: string, sessionDir: string): string {
	const lines = [
		"",
		"## dev-session",
		"",
		"This project uses dev-session to manage AI coding sessions.",
		"",
		"### Session workflow",
		"",
		`Start: Read ${sessionDir}/SESSION_STATE.md to find the active chunk, then load only the files tagged to that chunk in FILE_INDEX.md. Confirm before writing code.`,
		"",
		`End: Update SESSION_STATE.md (mark tasks done), update FILE_INDEX.md (add new files), rewrite NEXT_PROMPT.md (max 15 lines). See ${sessionDir}/ROUTINES.md for the full routine.`,
		"",
		`Ignore: ${sessionDir}/DONE_LOG.md, ${sessionDir}/PLAN_*.md (except active chunk)`,
		"",
	];
	return lines.join("\n");
}

/**
 * Inserts or replaces the dev-session section in .cursorrules content.
 *
 * @param existing - The existing .cursorrules content (or empty string).
 * @param sectionContent - The new section content.
 * @returns The updated .cursorrules content.
 */
function upsertSection(existing: string, sectionContent: string): string {
	const startIdx = existing.indexOf(SECTION_START);
	const endIdx = existing.indexOf(SECTION_END);

	const wrapped = `${SECTION_START}\n${sectionContent}\n${SECTION_END}`;

	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const before = existing.slice(0, startIdx);
		const after = existing.slice(endIdx + SECTION_END.length);
		return `${before}${wrapped}${after}`;
	}

	const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
	const extraNewline = existing.length > 0 ? "\n" : "";
	return `${existing}${separator}${extraNewline}${wrapped}\n`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Cursor adapter.
 *
 * Integrates dev-session with Cursor by managing a .cursorrules section
 * with session workflow instructions and ignore directives.
 */
export const CursorAdapter: Adapter = {
	config: CURSOR_CONFIG,
	formatter: CursorBootstrapFormatter,

	/**
	 * Generates or updates the dev-session section in .cursorrules.
	 *
	 * @param context - Setup context with project paths and detection info.
	 * @returns Result describing what was written.
	 */
	async setup(context: AdapterSetupContext): Promise<AdapterSetupResult> {
		const projectName = context.projectInfo.project_name ?? "project";
		const sessionDir = ".session";

		const existing = context.readFile(CURSORRULES_PATH) ?? "";
		const section = generateSessionSection(projectName, sessionDir);
		const updated = upsertSection(existing, section);

		context.writeFile(CURSORRULES_PATH, updated);

		const verb = existing.length > 0 ? "Updated" : "Created";
		return {
			filesWritten: [CURSORRULES_PATH],
			summary: `${verb} .cursorrules with dev-session workflow section`,
		};
	},

	/**
	 * No-op for Cursor — session state format works as-is.
	 *
	 * @param state - Current session state.
	 * @param _context - Transform context.
	 * @returns Unchanged state.
	 */
	transformState(state: SessionState, _context: TransformStateContext): SessionState {
		return state;
	},

	/**
	 * Called at session start — no-op for Cursor.
	 *
	 * @param _context - Session lifecycle context.
	 */
	async onSessionStart(_context: SessionLifecycleContext): Promise<void> {
		// No-op — Cursor reads .cursorrules automatically
	},

	/**
	 * Updates the .cursorrules dev-session section with current state.
	 *
	 * @param context - Session lifecycle context.
	 */
	async onSessionEnd(context: SessionLifecycleContext): Promise<void> {
		const existing = context.readFile(CURSORRULES_PATH);
		if (existing === undefined) {
			return;
		}

		const projectName = context.chunk.title;
		const section = generateSessionSection(projectName, ".session");
		const updated = upsertSection(existing, section);

		context.writeFile(CURSORRULES_PATH, updated);
	},
};

// Exported for testing
export { CURSORRULES_PATH, generateSessionSection, SECTION_END, SECTION_START, upsertSection };
