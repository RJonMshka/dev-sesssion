/**
 * Regenerates `NEXT_PROMPT.md` and `context-manifest.json`.
 *
 * Every command that writes the prompt — `init`, `update`, `advance`, `index`,
 * `import`, `trim` — comes through here, and `preview` loads its input the same
 * way (REQ-RUN-19). The assembly itself is
 * `PromptAssembler.assemble` in core, so the same `.session/` yields the same
 * prompt whichever command wrote it (LLD-first-run.md, REQ-RUN-16). This module
 * only loads inputs, resolves the adapter, scans, and persists.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "@clack/prompts";
import {
	type AiIndex,
	AiIndexManager,
	type AssembledPrompt,
	type AssembleInput,
	CONTEXT_MANIFEST_FILENAME,
	ContextManifest,
	type FileIndexEntry,
	FileIndexManager,
	NextPromptWriter,
	type PlanChunk,
	PlanChunkManager,
	PromptAssembler,
	type SessionState,
	SessionStateManager,
	TrimOverridesManager,
} from "@dev-session/core";
import { CliError, SecretScanner, type ValidatedPath } from "@dev-session/security";
import { createAdapterReadFile } from "../utils/adapter-io.js";
import { dryRunWrite } from "../utils/dry-run.js";
import { resolveAdapter } from "../utils/resolve-adapter.js";

/** How to regenerate, and any inputs the caller already holds in memory. */
export interface RegenerateOptions {
	readonly cwd: string;
	readonly dryRun: boolean;
	readonly verbose: boolean;
	/** Throw instead of warning when the prompt contains a secret. */
	readonly blockOnSecrets: boolean;
	/** Explicit adapter override (from --adapter). */
	readonly adapter?: string;
	/** State the caller has just changed; loaded from disk when absent. */
	readonly state?: SessionState;
	/** The active chunk; loaded for `state` when absent. */
	readonly chunk?: PlanChunk;
	/** Every chunk; loaded from disk when absent. */
	readonly allChunks?: readonly PlanChunk[];
	/** FILE_INDEX entries; loaded from disk when absent. */
	readonly entries?: readonly FileIndexEntry[];
	/** The ai-index (`null` for none); loaded from disk when absent. */
	readonly index?: AiIndex | null;
	/** Trimmed paths; loaded from `trim-overrides.json` when absent. */
	readonly excluded?: readonly string[];
}

/** What {@link loadAssembleInput} needs: the inputs, and how to pick the adapter. */
export type LoadOptions = Omit<RegenerateOptions, "dryRun" | "blockOnSecrets">;

/** The regenerated prompt and how many secrets the scan reported. */
export interface RegenerateResult extends AssembledPrompt {
	readonly secretWarnings: number;
}

/**
 * Assembles the prompt from `.session/` (or the caller's in-memory inputs),
 * scans it, and writes the prompt and manifest — or logs them under dry-run
 * (REQ-RUN-15).
 *
 * @param sessionDir - Validated path to `.session/`.
 * @param options - Inputs and flags.
 * @returns The assembled prompt, budget and manifest, plus the secret count.
 * @throws {CliError} If `blockOnSecrets` is set and the scan finds a secret.
 */
export function regeneratePrompt(
	sessionDir: ValidatedPath,
	options: RegenerateOptions,
): RegenerateResult {
	const input = loadAssembleInput(sessionDir, options);
	const assembled = PromptAssembler.assemble(input);
	const secretWarnings = scanPrompt(assembled.prompt, options);
	persist(sessionDir, assembled, input.state.max_prompt_lines, options);
	return { ...assembled, secretWarnings };
}

/**
 * Regenerates the prompt after a command changed what it is built from, but
 * only when a prompt already exists to keep current (REQ-RUN-13, -14, -22).
 * Callers skip it under dry-run (REQ-RUN-15).
 *
 * @param sessionDir - Validated path to `.session/`.
 * @param options - Inputs and flags.
 * @returns Whether the prompt was regenerated.
 * @throws {CliError} If `blockOnSecrets` is set and the scan finds a secret.
 */
export function refreshExistingPrompt(
	sessionDir: ValidatedPath,
	options: RegenerateOptions,
): boolean {
	if (!fs.existsSync(path.join(sessionDir, "NEXT_PROMPT.md"))) return false;
	regeneratePrompt(sessionDir, options);
	return true;
}

/**
 * Loads everything {@link PromptAssembler.assemble} needs, from the caller's
 * in-memory inputs or from `.session/`, and resolves the adapter. `preview`
 * uses this too, so it shows the prompt the other commands write (REQ-RUN-19).
 *
 * @param sessionDir - Validated path to `.session/`.
 * @param options - Inputs and the adapter override.
 * @returns The assembly input.
 * @throws {ParseError} If a `.session/` file fails to parse.
 */
export function loadAssembleInput(sessionDir: ValidatedPath, options: LoadOptions): AssembleInput {
	const state = options.state ?? SessionStateManager.load(sessionDir);
	const { adapter, tool, source } = resolveAdapter(options.cwd, options.adapter);
	if (options.verbose) {
		log.info(`Using ${adapter.config.display_name} adapter (${source}: ${tool})`);
	}
	const transform = adapter.transformState?.bind(adapter);
	const context = {
		projectRoot: options.cwd,
		sessionDir,
		readFile: createAdapterReadFile(options.cwd),
	};

	return {
		state,
		chunk: options.chunk ?? PlanChunkManager.loadActive(sessionDir, state),
		allChunks: options.allChunks ?? PlanChunkManager.loadAll(sessionDir),
		// FILE_INDEX.md stores no costs, and init's own always-include entries
		// have none either; measure every entry so all commands charge the same
		// real sizes (REQ-BUD-4). Entries that already carry a cost keep it.
		entries: FileIndexManager.withMeasuredCosts(
			options.entries ?? FileIndexManager.load(sessionDir),
			options.cwd,
		),
		index: options.index !== undefined ? options.index : AiIndexManager.load(sessionDir),
		formatter: adapter.formatter,
		// The name typed at init, when it differed from the detected one (REQ-RUN-21).
		projectName: state.project_name ?? detectProjectName(options.cwd),
		excluded:
			options.excluded ??
			TrimOverridesManager.getExcludedPaths(TrimOverridesManager.load(sessionDir)),
		...(transform ? { transformState: (s: SessionState) => transform(s, context) } : {}),
	};
}

/**
 * Writes the prompt and manifest, or logs them under dry-run.
 *
 * @param sessionDir - Validated path to `.session/`.
 * @param assembled - The assembled prompt.
 * @param maxLines - The state's prompt line cap.
 * @param options - Flags.
 */
function persist(
	sessionDir: ValidatedPath,
	assembled: AssembledPrompt,
	maxLines: number,
	options: RegenerateOptions,
): void {
	if (options.dryRun) {
		dryRunWrite(path.join(sessionDir, "NEXT_PROMPT.md"), assembled.prompt, options.cwd);
		dryRunWrite(
			path.join(sessionDir, CONTEXT_MANIFEST_FILENAME),
			ContextManifest.serialize(assembled.manifest),
			options.cwd,
		);
		return;
	}
	NextPromptWriter.write(sessionDir, assembled.prompt, maxLines);
	ContextManifest.write(sessionDir, assembled.manifest);
}

/**
 * Scans the prompt for secrets, warning — or throwing when blocking.
 *
 * @param prompt - The prompt content.
 * @param options - Flags.
 * @returns The number of findings.
 * @throws {CliError} If `blockOnSecrets` is set and there are findings.
 */
function scanPrompt(prompt: string, options: RegenerateOptions): number {
	const results = SecretScanner.scan(prompt);
	if (results.length === 0) return 0;
	const count = `${String(results.length)} issue${results.length === 1 ? "" : "s"}`;
	log.warn(`Secret scan found ${count} in NEXT_PROMPT.md`);
	if (options.verbose) {
		for (const r of results) log.message(`  Line ${String(r.line)}: ${r.pattern} (${r.redacted})`);
	}
	if (options.blockOnSecrets) {
		throw new CliError({
			message: `Secret scan found ${count} — blocking write in strict mode`,
			suggestion: "Remove secrets from session state or notes, then retry.",
		});
	}
	return results.length;
}

/**
 * Detects the project name from `package.json`, falling back to the directory
 * name.
 *
 * @param cwd - Project root.
 * @returns The project name.
 */
export function detectProjectName(cwd: string): string {
	try {
		const pkg: unknown = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
		if (typeof pkg === "object" && pkg !== null && "name" in pkg && typeof pkg.name === "string") {
			return pkg.name;
		}
	} catch {
		// No package.json or invalid JSON
	}
	return path.basename(cwd);
}
