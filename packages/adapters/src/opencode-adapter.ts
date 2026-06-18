/**
 * opencode adapter — full lifecycle adapter for opencode integration.
 *
 * Wraps {@link OpencodeBootstrapFormatter} with lifecycle hooks that:
 * - Generate a dev-sesssion section in AGENTS.md during init
 * - Update AGENTS.md session section on session end
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
import { OpencodeBootstrapFormatter } from "./opencode-bootstrap-formatter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Marker comments that delimit the dev-sesssion section in AGENTS.md. */
const SECTION_START = "<!-- dev-sesssion:start -->";
const SECTION_END = "<!-- dev-sesssion:end -->";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Static metadata for the opencode adapter. */
const OPENCODE_CONFIG: AdapterConfig = {
	name: "opencode",
	display_name: "opencode",
	detect_files: ["AGENTS.md", "opencode.json"],
	output_files: ["AGENTS.md"],
	config_version: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates the dev-sesssion section content for AGENTS.md.
 *
 * @param projectName - The project name.
 * @param sessionDir - Relative path to the session directory.
 * @returns The section content (without markers).
 */
function generateSessionSection(_projectName: string, sessionDir: string): string {
	const lines = [
		"",
		"## dev-sesssion",
		"",
		`This project uses dev-sesssion to manage AI coding sessions.`,
		"",
		"### Session workflow",
		"",
		`**Start:** Read \`${sessionDir}/SESSION_STATE.md\` to find the active chunk, then load only the files tagged to that chunk in \`FILE_INDEX.md\`. Confirm before writing code.`,
		"",
		`**End:** Update \`SESSION_STATE.md\` (mark tasks done), update \`FILE_INDEX.md\` (add new files), rewrite \`NEXT_PROMPT.md\` (max 15 lines). See \`${sessionDir}/ROUTINES.md\` for the full routine.`,
		"",
		`Exclude: ${sessionDir}/DONE_LOG.md, ${sessionDir}/PLAN_*.md (except active chunk)`,
		"",
	];
	return lines.join("\n");
}

/**
 * Inserts or replaces the dev-sesssion section in AGENTS.md content.
 *
 * @param existing - The existing AGENTS.md content (or empty string).
 * @param sectionContent - The new section content.
 * @returns The updated AGENTS.md content.
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
 * opencode adapter.
 *
 * Integrates dev-sesssion with opencode by managing an AGENTS.md section
 * with session workflow instructions and exclude directives.
 */
export const OpencodeAdapter: Adapter = {
	config: OPENCODE_CONFIG,
	formatter: OpencodeBootstrapFormatter,

	/**
	 * Generates or updates the dev-sesssion section in AGENTS.md.
	 *
	 * @param context - Setup context with project paths and detection info.
	 * @returns Result describing what was written.
	 */
	async setup(context: AdapterSetupContext): Promise<AdapterSetupResult> {
		const projectName = context.projectInfo.project_name ?? "project";
		const sessionDir = ".session";

		const existing = context.readFile("AGENTS.md") ?? "";
		const section = generateSessionSection(projectName, sessionDir);
		const updated = upsertSection(existing, section);

		context.writeFile("AGENTS.md", updated);

		const verb = existing.length > 0 ? "Updated" : "Created";
		return {
			filesWritten: ["AGENTS.md"],
			summary: `${verb} AGENTS.md with dev-sesssion workflow section`,
		};
	},

	/**
	 * No-op for opencode — session state format works as-is.
	 *
	 * @param state - Current session state.
	 * @param _context - Transform context.
	 * @returns Unchanged state.
	 */
	transformState(state: SessionState, _context: TransformStateContext): SessionState {
		return state;
	},

	/**
	 * Called at session start — no-op for opencode.
	 *
	 * @param _context - Session lifecycle context.
	 */
	async onSessionStart(_context: SessionLifecycleContext): Promise<void> {
		// No-op — opencode reads AGENTS.md automatically
	},

	/**
	 * Updates the AGENTS.md dev-sesssion section with current state.
	 *
	 * @param context - Session lifecycle context.
	 */
	async onSessionEnd(context: SessionLifecycleContext): Promise<void> {
		const existing = context.readFile("AGENTS.md");
		if (existing === undefined) {
			return;
		}

		const projectName = context.chunk.title;
		const section = generateSessionSection(projectName, ".session");
		const updated = upsertSection(existing, section);

		context.writeFile("AGENTS.md", updated);
	},
};

// Exported for testing
export { generateSessionSection, SECTION_END, SECTION_START, upsertSection };
