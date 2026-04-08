/**
 * Claude Code adapter — full lifecycle adapter for Claude Code integration.
 *
 * Wraps {@link ClaudeBootstrapFormatter} with lifecycle hooks that:
 * - Generate a dev-session section in CLAUDE.md during init
 * - Read `.claude/MEMORY.md` and inject relevant context into session notes
 * - Update CLAUDE.md session section on session end
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
import { ClaudeBootstrapFormatter } from "./claude-bootstrap-formatter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum lines to read from .claude/MEMORY.md. */
const MAX_MEMORY_LINES = 200;

/** Marker comments that delimit the dev-session section in CLAUDE.md. */
const SECTION_START = "<!-- dev-session:start -->";
const SECTION_END = "<!-- dev-session:end -->";

/** Path to Claude Code's memory index file. */
const MEMORY_PATH = ".claude/MEMORY.md";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Static metadata for the Claude Code adapter. */
const CLAUDE_CONFIG: AdapterConfig = {
	name: "claude",
	display_name: "Claude Code",
	detect_files: ["CLAUDE.md", ".claude"],
	output_files: ["CLAUDE.md"],
	config_version: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates the dev-session section content for CLAUDE.md.
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
		`This project uses [dev-session](https://github.com/anthropics/dev-session) to manage AI coding sessions.`,
		"",
		"### Session workflow",
		"",
		`**Start:** Read \`${sessionDir}/SESSION_STATE.md\` → note active chunk → load only files tagged to that chunk in \`FILE_INDEX.md\` → confirm before writing code.`,
		"",
		`**End:** Update \`SESSION_STATE.md\` (mark tasks done), update \`FILE_INDEX.md\` (add new files), rewrite \`NEXT_PROMPT.md\` (≤15 lines, self-contained). See \`${sessionDir}/ROUTINES.md\` for the full routine. Do not skip this.`,
		"",
	];
	return lines.join("\n");
}

/**
 * Inserts or replaces the dev-session section in CLAUDE.md content.
 *
 * If the section markers exist, replaces the content between them.
 * Otherwise, appends the section at the end.
 *
 * @param existing - The existing CLAUDE.md content (or empty string).
 * @param sectionContent - The new section content.
 * @returns The updated CLAUDE.md content.
 */
function upsertSection(existing: string, sectionContent: string): string {
	const startIdx = existing.indexOf(SECTION_START);
	const endIdx = existing.indexOf(SECTION_END);

	const wrapped = `${SECTION_START}\n${sectionContent}\n${SECTION_END}`;

	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		// Replace existing section
		const before = existing.slice(0, startIdx);
		const after = existing.slice(endIdx + SECTION_END.length);
		return `${before}${wrapped}${after}`;
	}

	// Append to end
	const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
	const extraNewline = existing.length > 0 ? "\n" : "";
	return `${existing}${separator}${extraNewline}${wrapped}\n`;
}

/**
 * Extracts summary lines from .claude/MEMORY.md content.
 *
 * Reads up to {@link MAX_MEMORY_LINES} and returns non-empty, non-heading lines
 * that look like memory index entries (lines starting with `- `).
 *
 * @param content - The raw MEMORY.md content.
 * @returns Array of memory summary strings.
 */
function extractMemorySummaries(content: string): readonly string[] {
	const lines = content.split("\n").slice(0, MAX_MEMORY_LINES);
	const summaries: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		// Memory index entries are markdown list items: "- [Title](file.md) — description"
		if (trimmed.startsWith("- ")) {
			summaries.push(trimmed.slice(2).trim());
		}
	}

	return summaries;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Claude Code adapter.
 *
 * Integrates dev-session with Claude Code by:
 * - Adding a session workflow section to CLAUDE.md during `setup`
 * - Reading `.claude/MEMORY.md` summaries into session notes via `transformState`
 * - Updating the CLAUDE.md session section on `onSessionEnd`
 */
export const ClaudeAdapter: Adapter = {
	config: CLAUDE_CONFIG,
	formatter: ClaudeBootstrapFormatter,

	/**
	 * Generates or updates the dev-session section in CLAUDE.md.
	 *
	 * @param context - Setup context with project paths and detection info.
	 * @returns Result describing what was written.
	 */
	async setup(context: AdapterSetupContext): Promise<AdapterSetupResult> {
		const projectName = context.projectInfo.project_name ?? "project";
		const sessionDir = ".session";

		const existing = context.readFile("CLAUDE.md") ?? "";
		const section = generateSessionSection(projectName, sessionDir);
		const updated = upsertSection(existing, section);

		context.writeFile("CLAUDE.md", updated);

		const verb = existing.length > 0 ? "Updated" : "Created";
		return {
			filesWritten: ["CLAUDE.md"],
			summary: `${verb} CLAUDE.md with dev-session workflow section`,
		};
	},

	/**
	 * Reads .claude/MEMORY.md and injects memory summaries as session notes.
	 *
	 * Memory entries are prefixed with `[memory]` to distinguish them from
	 * user-added notes. Only the first {@link MAX_MEMORY_LINES} lines are read.
	 *
	 * @param state - Current session state.
	 * @param context - Transform context with project paths.
	 * @returns State with memory summaries appended to notes.
	 */
	transformState(state: SessionState, context: TransformStateContext): SessionState {
		const memoryContent = context.readFile(MEMORY_PATH);
		if (memoryContent === undefined) {
			return state;
		}

		const summaries = extractMemorySummaries(memoryContent);
		if (summaries.length === 0) {
			return state;
		}

		// Avoid duplicating memory notes if already injected
		const existingMemoryNotes = state.notes.filter((n) => n.startsWith("[memory] "));
		if (existingMemoryNotes.length > 0) {
			return state;
		}

		const memoryNotes = summaries.slice(0, 5).map((s) => `[memory] ${s}`);

		return {
			...state,
			notes: [...state.notes, ...memoryNotes],
		};
	},

	/**
	 * Called at session start — currently a no-op for Claude Code.
	 *
	 * Future: could validate CLAUDE.md section exists and warn if missing.
	 *
	 * @param _context - Session lifecycle context.
	 */
	async onSessionStart(_context: SessionLifecycleContext): Promise<void> {
		// No-op — Claude Code reads CLAUDE.md automatically
	},

	/**
	 * Updates the CLAUDE.md dev-session section with current session state.
	 *
	 * @param context - Session lifecycle context with current state.
	 */
	async onSessionEnd(context: SessionLifecycleContext): Promise<void> {
		const existing = context.readFile("CLAUDE.md");
		if (existing === undefined) {
			// No CLAUDE.md to update — skip silently
			return;
		}

		const projectName = context.chunk.title;
		const section = generateSessionSection(projectName, ".session");
		const updated = upsertSection(existing, section);

		context.writeFile("CLAUDE.md", updated);
	},
};

// Exported for testing
export {
	extractMemorySummaries,
	generateSessionSection,
	MEMORY_PATH,
	SECTION_END,
	SECTION_START,
	upsertSection,
};
