/**
 * Final writes phase for `dev-sesssion init`.
 *
 * Writes SESSION_STATE.md, ROUTINES.md, NEXT_PROMPT.md, runs the
 * secret scanner on all written content, and offers to patch `.gitignore`.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { confirm, isCancel, log } from "@clack/prompts";
import type { AiIndex, FileIndexEntry, PlanChunk, SessionState } from "@dev-session/core";
import {
	ContextBudgetCalculator,
	MAX_PROMPT_LINES,
	PlanChunkManager,
	RoutinesWriter,
	SessionStateManager,
} from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, CliError, PathValidator, SecretScanner } from "@dev-session/security";
import { readVersion } from "../read-version.js";
import { createAdapterReadFile, createAdapterWriteFile } from "../utils/adapter-io.js";
import { dryRunGitignorePatch, dryRunWrite } from "../utils/dry-run.js";
import { resolveAdapter } from "../utils/resolve-adapter.js";
import { detectProjectName, regeneratePrompt } from "./regenerate-prompt.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the final writes phase. */
export interface FinalWriteOptions {
	readonly cwd: string;
	readonly yes: boolean;
	readonly dryRun: boolean;
	readonly verbose: boolean;
	readonly strict: boolean;
	/** Explicit adapter override (from --adapter flag). */
	readonly adapter?: string;
	/** Team mode — auto-applies .gitignore and .gitattributes patches. */
	readonly teamMode?: boolean;
	/**
	 * The ai-index init built this run (`null` if building it failed). When
	 * absent, whatever `ai-index.yaml` is on disk is used.
	 */
	readonly index?: AiIndex | null;
	/** The chunk to start at; the lowest-numbered when absent (REQ-RUN-27). */
	readonly startChunk?: number;
}

/** Result from the final writes phase. */
export interface FinalWriteResult {
	/** Total files written (0 in dry-run mode). */
	readonly filesWritten: number;
	/** Whether .gitignore was patched. */
	readonly gitignorePatched: boolean;
	/** Whether .gitattributes was patched (team mode only). */
	readonly gitattributesPatched: boolean;
	/** Number of secret scan warnings. */
	readonly secretWarnings: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lines to add to .gitignore in personal mode (generated artifacts). */
const GITIGNORE_ENTRIES_PERSONAL = [
	"",
	"# dev-sesssion (ephemeral session state)",
	".session/SESSION_STATE.md",
	".session/NEXT_PROMPT.md",
	".session/DONE_LOG.md",
	".session/ai-index.yaml",
	".session/context-manifest.json",
] as const;

/** Lines to add to .gitignore in team mode (only truly ephemeral files). */
const GITIGNORE_ENTRIES_TEAM = [
	"",
	"# dev-sesssion (ephemeral session state)",
	".session/SESSION_STATE.md",
	".session/NEXT_PROMPT.md",
	".session/DONE_LOG.md",
	".session/context-manifest.json",
] as const;

/** Lines to add to .gitattributes for team merge strategy. */
const GITATTRIBUTES_ENTRIES = [
	"",
	"# dev-sesssion (team merge strategy)",
	".session/FILE_INDEX.md merge=ours",
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute the final writes phase of init.
 *
 * Creates SESSION_STATE.md, ROUTINES.md, NEXT_PROMPT.md, scans for
 * secrets, and optionally patches .gitignore.
 *
 * @param sessionDir - Validated path to the `.session/` directory.
 * @param chunks - The plan chunks (from split or scaffold).
 * @param entries - The file index entries (from generate-index).
 * @param projectName - The project name for NEXT_PROMPT.
 * @param options - CLI options.
 * @returns The final write result.
 * @throws {CliError} If writes fail.
 */
export async function runFinalWrites(
	sessionDir: ValidatedPath,
	chunks: readonly PlanChunk[],
	entries: readonly FileIndexEntry[],
	projectName: string,
	options: FinalWriteOptions,
): Promise<FinalWriteResult> {
	let filesWritten = 0;
	let secretWarnings = 0;

	if (chunks.length === 0) {
		throw new CliError({
			message: "No plan chunks available. Cannot create session state.",
			suggestion: "Ensure plan splitting or scaffolding produced at least one chunk.",
		});
	}
	const { active: activeChunk, completedIds } = PlanChunkManager.startAt(
		chunks,
		options.startChunk,
	);

	// --- 1. Write SESSION_STATE.md ---
	// Chunks below the starting one are recorded as advance would (REQ-RUN-28).
	const today = new Date().toISOString().slice(0, 10);
	const sessionState: SessionState = {
		...buildInitialState(activeChunk, projectName, options.cwd),
		completed_chunks: Object.fromEntries(completedIds.map((id) => [String(id), today])),
	};
	const stateContent = serializeSessionState(sessionState);

	secretWarnings += scanContent(stateContent, "SESSION_STATE.md", options.verbose);

	if (options.dryRun) {
		dryRunWrite(path.join(sessionDir, "SESSION_STATE.md"), stateContent, options.cwd);
	} else {
		SessionStateManager.save(sessionDir, sessionState);
		filesWritten++;
	}

	// --- 2. Write ROUTINES.md ---
	if (options.dryRun) {
		dryRunWrite(path.join(sessionDir, "ROUTINES.md"), "(ROUTINES.md template)", options.cwd);
	} else {
		RoutinesWriter.write(sessionDir);
		filesWritten++;
	}

	// --- 3. Resolve the adapter ---
	const { adapter, tool: detectedTool } = resolveAdapter(options.cwd, options.adapter);

	// --- 3a. Run adapter setup (generates tool-specific files like CLAUDE.md) ---
	if (!options.dryRun && adapter.setup) {
		const projectInfo = {
			tool: detectedTool,
			project_type: "unknown" as const,
			existing_files: [] as string[],
			project_root: options.cwd,
			has_existing_session: true,
			project_name: projectName,
		};

		const setupResult = await adapter.setup({
			projectRoot: options.cwd,
			sessionDir,
			projectInfo,
			isReinit: false,
			writeFile: createAdapterWriteFile(options.cwd),
			readFile: createAdapterReadFile(options.cwd),
			version: readVersion(),
		});

		if (options.verbose) {
			log.info(`Adapter setup: ${setupResult.summary}`);
		}
		for (const notice of setupResult.notices ?? []) log.info(notice);
	}

	// --- 3b. Write NEXT_PROMPT.md + manifest, from the ai-index init just built (REQ-RUN-10) ---
	const { budget, secretWarnings: promptWarnings } = regeneratePrompt(sessionDir, {
		cwd: options.cwd,
		dryRun: options.dryRun,
		verbose: options.verbose,
		blockOnSecrets: false,
		...(options.adapter !== undefined ? { adapter: options.adapter } : {}),
		state: sessionState,
		chunk: activeChunk,
		allChunks: chunks,
		entries,
		...(options.index !== undefined ? { index: options.index } : {}),
	});
	secretWarnings += promptWarnings;
	if (!options.dryRun) filesWritten += 2;

	// --- 4. Offer to patch .gitignore ---
	const gitignorePatched = await patchGitignore(options);

	// --- 5. Patch .gitattributes in team mode ---
	const gitattributesPatched = options.teamMode === true ? patchGitattributes(options) : false;

	if (!options.dryRun) {
		log.info(ContextBudgetCalculator.formatSummary(budget)); // carries its own label (REQ-RUN-17)
	}

	return {
		filesWritten,
		gitignorePatched,
		gitattributesPatched,
		secretWarnings,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the initial session state for chunk 1.
 *
 * The project name is recorded only when it differs from the detected one —
 * that is, when it was typed while scaffolding — so every later command shows
 * the same name (REQ-RUN-21).
 *
 * @param activeChunk - The first plan chunk.
 * @param projectName - The project name init settled on.
 * @param cwd - Project root, for detecting the default name.
 * @returns A fresh SessionState.
 */
function buildInitialState(activeChunk: PlanChunk, projectName: string, cwd: string): SessionState {
	const typedName = projectName.trim();
	const sessionId = generateSessionId();
	const nowDate = new Date().toISOString().slice(0, 10);
	const nowIso = new Date().toISOString();

	return {
		active_chunk: activeChunk.chunk_id,
		session_id: sessionId,
		last_updated: nowDate,
		tasks: activeChunk.tasks.map((t) => ({
			text: t.text,
			status: t.status,
			added_at: nowIso,
		})),
		last_worked_files: [],
		max_prompt_lines: MAX_PROMPT_LINES,
		notes: [`Session initialized on ${nowDate}`],
		completed_chunks: {},
		...(typedName.length > 0 && typedName !== detectProjectName(cwd)
			? { project_name: typedName }
			: {}),
	};
}

/**
 * Generate a UUID v4 session ID.
 *
 * Uses Node.js crypto.randomUUID when available.
 *
 * @returns A UUID v4 string.
 */
function generateSessionId(): string {
	// Node 20+ always has crypto.randomUUID
	return crypto.randomUUID();
}

/**
 * Serialize a SessionState to YAML frontmatter format.
 *
 * This mirrors what SessionStateManager.save() writes, but returns
 * the string for scanning purposes.
 *
 * @param state - The session state.
 * @returns YAML-frontmattered markdown string.
 */
function serializeSessionState(state: SessionState): string {
	const lines: string[] = [
		"---",
		`active_chunk: ${state.active_chunk}`,
		`session_id: "${state.session_id}"`,
		`last_updated: "${state.last_updated}"`,
		"---",
		"",
		"# Session State",
		"",
		`## Active Chunk: ${state.active_chunk}`,
		"",
	];

	if (state.tasks.length > 0) {
		for (const task of state.tasks) {
			const marker = task.status === "done" ? "x" : " ";
			lines.push(`- [${marker}] ${task.text}`);
		}
		lines.push("");
	}

	if (state.notes.length > 0) {
		lines.push("## Notes");
		lines.push("");
		for (const note of state.notes) {
			lines.push(`- ${note}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Scan content for secrets and log warnings.
 *
 * @param content - The content to scan.
 * @param filename - The filename (for logging).
 * @param verbose - Whether to log individual findings.
 * @returns Number of warnings found.
 */
function scanContent(content: string, filename: string, verbose: boolean): number {
	const results = SecretScanner.scan(content);
	if (results.length > 0) {
		log.warn(
			`Secret scan found ${results.length} issue${results.length === 1 ? "" : "s"} in ${filename}`,
		);
		if (verbose) {
			for (const r of results) {
				log.message(`  Line ${r.line}: ${r.pattern} (${r.redacted})`);
			}
		}
	}
	return results.length;
}

/**
 * Offer to patch .gitignore with session-specific entries.
 *
 * In team mode (`options.teamMode === true`) or with `--yes`, the patch is
 * applied automatically without a confirmation prompt.
 *
 * @param options - CLI options.
 * @returns Whether the patch was applied.
 */
async function patchGitignore(options: FinalWriteOptions): Promise<boolean> {
	const gitignorePath = path.join(options.cwd, ".gitignore");

	// Check if entries already exist
	let existingContent = "";
	try {
		existingContent = fs.readFileSync(gitignorePath, "utf-8");
	} catch {
		// No .gitignore — we'll create one
	}

	// In team mode, ai-index.yaml is committed (not gitignored).
	// In personal mode, ai-index.yaml is a generated artifact → gitignored.
	const entriesToAdd =
		options.teamMode === true ? GITIGNORE_ENTRIES_TEAM : GITIGNORE_ENTRIES_PERSONAL;

	const alreadyPatched = entriesToAdd.some(
		(entry) => entry.trim().length > 0 && existingContent.includes(entry),
	);

	if (alreadyPatched) {
		if (options.verbose) {
			log.info(".gitignore already contains dev-sesssion entries.");
		}
		return false;
	}

	if (options.dryRun) {
		dryRunGitignorePatch(gitignorePath, [...entriesToAdd], options.cwd);
		return false;
	}

	// Team mode or --yes: apply automatically, no prompt
	let shouldPatch: boolean;
	if (options.teamMode === true || options.yes) {
		shouldPatch = true;
	} else {
		const result = await confirm({
			message: "Add session files to .gitignore?",
		});

		if (isCancel(result)) {
			shouldPatch = false;
		} else {
			shouldPatch = result;
		}
	}

	if (shouldPatch) {
		const newContent = `${existingContent}${entriesToAdd.join("\n")}\n`;
		const validatedPath = PathValidator.safeResolvePath(".gitignore", options.cwd);
		AtomicWriter.writeFile(validatedPath, newContent, { skipGuard: true });
		log.success("Patched .gitignore with session entries.");
		return true;
	}

	return false;
}

/**
 * Patch `.gitattributes` with the FILE_INDEX.md merge strategy entry.
 *
 * Applied automatically in team mode. The patch is idempotent — a second
 * call is a no-op if the entry is already present.
 *
 * @param options - CLI options (must have teamMode === true).
 * @returns Whether the patch was applied.
 */
function patchGitattributes(options: FinalWriteOptions): boolean {
	const gitattributesPath = path.join(options.cwd, ".gitattributes");

	let existingContent = "";
	try {
		existingContent = fs.readFileSync(gitattributesPath, "utf-8");
	} catch {
		// No .gitattributes — we'll create one
	}

	const alreadyPatched = GITATTRIBUTES_ENTRIES.some(
		(entry) => entry.trim().length > 0 && existingContent.includes(entry),
	);

	if (alreadyPatched) {
		if (options.verbose) {
			log.info(".gitattributes already contains dev-sesssion merge strategy.");
		}
		return false;
	}

	if (options.dryRun) {
		log.message(
			`  [dry-run] Would patch .gitattributes: ${GITATTRIBUTES_ENTRIES.filter((e) => e.trim()).join(", ")}`,
		);
		return false;
	}

	const newContent = `${existingContent}${GITATTRIBUTES_ENTRIES.join("\n")}\n`;
	const validatedPath = PathValidator.safeResolvePath(".gitattributes", options.cwd);
	AtomicWriter.writeFile(validatedPath, newContent, { skipGuard: true });
	log.success("Patched .gitattributes with FILE_INDEX.md merge=ours.");
	return true;
}
