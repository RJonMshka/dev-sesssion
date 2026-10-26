/**
 * `SessionManager` — a read/write facade over the `.session/` directory.
 *
 * Composes the individual managers (`SessionStateManager`, `PlanChunkManager`,
 * `FileIndexManager`, `AiIndexManager`) into a small, stable surface so that
 * transport layers (the CLI, the MCP server) never reach into individual
 * managers or perform their own path resolution. All inbound paths are treated
 * as untrusted and validated through {@link PathValidator}; all writes go
 * through the managers' `AtomicWriter` + `WriteGuard` paths.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";

import { AiIndexManager } from "../annotation/ai-index-manager.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { FileEntry, ParsedUnit } from "../annotation/types.js";
import { sliceLines } from "../annotation/unit-extractor.js";
import { checkPlanFile, type PlanCheckReport } from "../parsers/plan-sources/check.js";
import type { FileIndexEntry, PlanChunk, SessionState, Task } from "../schemas/index.js";
import { FileIndexManager } from "./file-index-manager.js";
import { PlanChunkManager } from "./plan-chunk-manager.js";
import { SessionStateManager } from "./session-state-manager.js";

/** Name of the session directory at the project root. */
const SESSION_DIRNAME = ".session";

/** Name of the next-prompt bootstrap file inside `.session/`. */
const NEXT_PROMPT_FILENAME = "NEXT_PROMPT.md";

/** The active chunk and its live task list. */
export interface ActiveChunkInfo {
	/** The numeric ID of the currently active chunk. */
	readonly activeChunk: number;
	/** The chunk's human-readable title (empty if no PLAN file is present). */
	readonly title: string;
	/** The live tasks for the active chunk (from SESSION_STATE.md). */
	readonly tasks: readonly Task[];
}

/** Result of attempting to mark a task done. */
export interface MarkTaskResult {
	/** Whether a task with the given text was found and marked done. */
	readonly matched: boolean;
	/** The task list after the operation. */
	readonly tasks: readonly Task[];
}

/**
 * An index query — exactly one selector must be provided. The facade rejects
 * queries that set zero or more than one selector.
 */
export interface IndexQuery {
	/** Match files carrying this free-form tag. */
	readonly tag?: string;
	/** Match files tagged to this chunk ID (plus always-include chunk 0). */
	readonly chunk?: number;
	/** Match files whose default layer equals this value. */
	readonly layer?: 0 | 1 | 2;
}

/**
 * Facade over a single project's `.session/` directory.
 *
 * Construct via {@link SessionManager.create}, which validates that the
 * `.session/` directory exists and resolves the project root safely.
 */
export class SessionManager {
	/**
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @param projectRoot - Validated absolute path to the project root.
	 * @param readOnly - When true, mutating operations throw instead of writing.
	 */
	private constructor(
		private readonly sessionDir: ValidatedPath,
		private readonly projectRoot: ValidatedPath,
		private readonly readOnly: boolean,
	) {}

	/**
	 * Create a `SessionManager` for the project rooted at `cwd`.
	 *
	 * @param cwd - The project working directory.
	 * @param options - Optional behavior flags.
	 * @param options.readOnly - Disable mutating operations (shared/team setups).
	 * @returns A configured `SessionManager`.
	 * @throws {CliError} If no `.session/` directory exists at `cwd`.
	 */
	static create(cwd: string, options: { readonly readOnly?: boolean } = {}): SessionManager {
		const projectRoot = PathValidator.safeResolvePath(".", cwd);
		const sessionDirAbs = path.join(projectRoot, SESSION_DIRNAME);

		if (!fs.existsSync(sessionDirAbs)) {
			throw new CliError({
				message: "No .session/ directory found",
				suggestion: "Run `dev-sesssion init` first to initialize the project.",
			});
		}

		const sessionDir = PathValidator.safeResolvePath(SESSION_DIRNAME, projectRoot);
		return new SessionManager(sessionDir, projectRoot, options.readOnly ?? false);
	}

	/** Whether this manager rejects mutating operations. */
	get isReadOnly(): boolean {
		return this.readOnly;
	}

	/**
	 * Get the active chunk, its title, and its tasks with their merged status.
	 *
	 * @returns The active chunk info.
	 * @throws {ParseError} If SESSION_STATE.md is missing or invalid.
	 */
	getActiveChunk(): ActiveChunkInfo {
		const state = SessionStateManager.load(this.sessionDir);
		const chunk = this.tryLoadActive(state);

		// The active chunk's tasks, status merged with state (REQ-WF-11). With no
		// PLAN_<n>.md, state's own list is all there is.
		return {
			activeChunk: state.active_chunk,
			title: chunk?.title ?? "",
			tasks: chunk?.tasks ?? state.tasks,
		};
	}

	/**
	 * List the files in FILE_INDEX.md, optionally filtered to a chunk.
	 *
	 * @param chunkId - If provided, returns files tagged to this chunk plus
	 *   always-include files (chunk 0). If omitted, returns every entry.
	 * @returns The matching file-index entries.
	 */
	listContextFiles(chunkId?: number): readonly FileIndexEntry[] {
		const entries = FileIndexManager.load(this.sessionDir);
		if (chunkId === undefined) {
			return entries;
		}
		return entries.filter(
			(entry) => entry.chunk_tags.includes(0) || entry.chunk_tags.includes(chunkId),
		);
	}

	/**
	 * Render a file at the requested context layer.
	 *
	 * The path is treated as untrusted: it is resolved against the project root
	 * via {@link PathValidator}, rejecting traversal and absolute-escape attempts.
	 *
	 * @param relPath - File path relative to the project root.
	 * @param layer - Context layer: 0 (summary), 1 (signatures), 2 (full source).
	 * @returns The rendered text for that layer.
	 * @throws {SecurityError} If the path escapes the project root.
	 * @throws {CliError} If the index is missing or has no entry for the path.
	 * @throws {ParseError} If layer 2 source cannot be read.
	 */
	readFileLayer(relPath: string, layer: 0 | 1 | 2): string {
		const validated = PathValidator.safeResolvePath(relPath, this.projectRoot);

		if (layer === 2) {
			return AiIndexManager.renderLayer2(validated);
		}

		const index = AiIndexManager.load(this.sessionDir);
		if (!index) {
			throw new CliError({
				message: "No ai-index.yaml found",
				suggestion: "Run `dev-sesssion index` first to generate the index.",
			});
		}

		const key = path.relative(index.project_root, validated).replace(/\\/g, "/");
		const entry = index.files[key];
		if (!entry) {
			throw new CliError({
				message: `No index entry for path: ${key}`,
				suggestion: "Run `dev-sesssion index` to regenerate the index, or check the path.",
			});
		}

		return layer === 0
			? AiIndexManager.renderLayer0(key, entry)
			: AiIndexManager.renderLayer1(key, entry);
	}

	/**
	 * Check a plan file the way `init` would read it, without writing anything
	 * (REQ-ORC-4). Allowed in read-only mode: it only reads.
	 *
	 * @param relPath - Plan file path relative to the project root. Untrusted.
	 * @returns The same report `plan check --json` prints.
	 * @throws {SecurityError} If the path escapes the project root.
	 * @throws {CliError} If the file cannot be read.
	 */
	checkPlan(relPath: string): PlanCheckReport {
		return checkPlanFile(relPath, this.projectRoot);
	}

	/**
	 * Return one code unit's current source (REQ-UNIT-23..25).
	 *
	 * The file is extracted as it stands now rather than looked up in the
	 * index, so the slice is right even after the code has moved on since the
	 * prompt was written. The first line is a header naming the unit, its
	 * range, cost and hash, so anything quoted from it stays traceable.
	 *
	 * @param ref - `path#id`, optionally with the `:start-end` suffix a Focus line carries.
	 * @returns The header line followed by the unit's source.
	 * @throws {SecurityError} If the path escapes the project root.
	 * @throws {CliError} If the reference has no id, the file is missing, or the id names no unit.
	 */
	readUnit(ref: string): string {
		const bare = ref.trim().replace(/:\d+-\d+$/, "");
		const hashAt = bare.indexOf("#");
		if (hashAt <= 0 || hashAt === bare.length - 1) {
			throw new CliError({
				message: `Not a unit reference: ${bare}`,
				suggestion: "Pass `path#id`, e.g. `src/utils.ts#parseBody` or `src/store.ts#Store.add`.",
			});
		}
		const relPath = bare.slice(0, hashAt);
		const id = bare.slice(hashAt + 1);
		const validated = PathValidator.safeResolvePath(relPath, this.projectRoot);
		if (!fs.existsSync(validated)) {
			throw new CliError({ message: `No such file: ${relPath}` });
		}

		const unit = findUnit(new AutoExtractor().extractFile(validated).units, id, relPath);
		const source = fs.readFileSync(validated, "utf-8");
		const header = `// ${relPath}#${unit.id} L${String(unit.start)}-${String(unit.end)} · ${String(unit.tokens)} tokens · hash ${unit.hash}`;
		return `${header}\n${sliceLines(source.split("\n"), unit.start, unit.end)}`;
	}

	/**
	 * Query the ai-index by exactly one of tag, chunk, or layer.
	 *
	 * @param query - The query selector (exactly one field set).
	 * @returns Matching file entries keyed by relative path.
	 * @throws {CliError} If the index is missing or the selector is ambiguous.
	 */
	queryIndex(query: IndexQuery): Record<string, FileEntry> {
		const selectors = [query.tag, query.chunk, query.layer].filter((v) => v !== undefined);
		if (selectors.length !== 1) {
			throw new CliError({
				message: "queryIndex requires exactly one of: tag, chunk, layer",
			});
		}

		const index = AiIndexManager.load(this.sessionDir);
		if (!index) {
			throw new CliError({
				message: "No ai-index.yaml found",
				suggestion: "Run `dev-sesssion index` first to generate the index.",
			});
		}

		if (query.tag !== undefined) {
			return AiIndexManager.queryByTag(index, query.tag);
		}
		if (query.chunk !== undefined) {
			const fileIndex = FileIndexManager.load(this.sessionDir);
			return AiIndexManager.queryByChunk(index, query.chunk, fileIndex);
		}
		// query.layer is defined here by the single-selector check above.
		return AiIndexManager.queryByLayer(index, query.layer as 0 | 1 | 2);
	}

	/**
	 * Mark a task done by exact text match and persist the change.
	 *
	 * @param text - The exact task text to mark done.
	 * @returns Whether a task matched, plus the resulting task list.
	 * @throws {CliError} If this manager is read-only.
	 */
	markTaskDone(text: string): MarkTaskResult {
		this.assertWritable("mark_task_done");

		const state = SessionStateManager.load(this.sessionDir);
		// A task of the active chunk that state does not list yet — e.g. state
		// written by an older `advance` — is recorded rather than missed (REQ-WF-10).
		const inChunk = this.tryLoadActive(state)?.tasks.some((t) => t.text === text) === true;
		const adopted = inChunk ? SessionStateManager.adoptTask(state, text) : state;
		const updated = SessionStateManager.markTaskDone(adopted, text);
		const matched = updated !== state;

		if (matched) {
			SessionStateManager.save(this.sessionDir, updated);
		}

		return { matched, tasks: updated.tasks };
	}

	/**
	 * Load the active chunk, or `undefined` when its PLAN_<n>.md is absent or invalid.
	 *
	 * @param state - The session state naming the active chunk.
	 * @returns The active chunk with merged task status, if it can be read.
	 */
	private tryLoadActive(state: SessionState): PlanChunk | undefined {
		try {
			return PlanChunkManager.loadActive(this.sessionDir, state);
		} catch {
			return undefined;
		}
	}

	/**
	 * Read the raw contents of NEXT_PROMPT.md.
	 *
	 * @returns The next-prompt bootstrap text.
	 * @throws {CliError} If NEXT_PROMPT.md does not exist.
	 */
	getNextPrompt(): string {
		const filePath = path.join(this.sessionDir, NEXT_PROMPT_FILENAME);
		if (!fs.existsSync(filePath)) {
			throw new CliError({
				message: "No NEXT_PROMPT.md found",
				suggestion: "Run `dev-sesssion update` to generate the next-session prompt.",
			});
		}
		// sessionDir is validated and the filename is a fixed constant.
		return fs.readFileSync(filePath, "utf-8");
	}

	/**
	 * Throw if this manager is read-only.
	 *
	 * @param operation - The operation name, used in the error message.
	 * @throws {CliError} If read-only.
	 */
	private assertWritable(operation: string): void {
		if (this.readOnly) {
			throw new CliError({
				message: `Operation "${operation}" is disabled in read-only mode`,
				suggestion: "Restart the MCP server without --read-only to allow writes.",
			});
		}
	}
}

/** Unit ids listed in an unknown-id error before summarizing. */
const MAX_IDS_LISTED = 20;

/**
 * Finds a unit by id, or explains which ids exist (REQ-UNIT-24).
 *
 * @param units - The file's current units.
 * @param id - The requested id.
 * @param relPath - The file, for the error message.
 * @returns The unit.
 * @throws {CliError} If no unit has that id.
 */
function findUnit(units: readonly ParsedUnit[], id: string, relPath: string): ParsedUnit {
	const unit = units.find((u) => u.id === id);
	if (unit !== undefined) return unit;
	const ids = units.map((u) => u.id);
	const shown = ids.slice(0, MAX_IDS_LISTED).join(", ");
	const more = ids.length > MAX_IDS_LISTED ? `, +${String(ids.length - MAX_IDS_LISTED)} more` : "";
	throw new CliError({
		message: `No unit "${id}" in ${relPath}`,
		suggestion: ids.length > 0 ? `Units in this file: ${shown}${more}` : "This file has no units.",
	});
}
