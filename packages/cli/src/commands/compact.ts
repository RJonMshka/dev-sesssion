/**
 * `dev-sesssion compact <file>` command.
 *
 * Uses the Anthropic API (Haiku model) to compress a context file,
 * preserving meaning while reducing token count. Before writing,
 * creates a timestamped backup in `.session/backups/`.
 *
 * After compaction, updates `FileIndexEntry.token_cost` in FILE_INDEX.md.
 *
 * Requires `ANTHROPIC_API_KEY` environment variable.
 *
 * File content is scanned for secrets before it leaves the machine — this is
 * the only command in the tool that performs network egress, so the scan
 * happens here rather than relying on `WriteGuard`, which only covers writes.
 *
 * Options:
 * - `--dry-run` — print compacted version to stdout without writing
 * - `--model <id>` — override default model (default: claude-haiku-4-5-20251001)
 * - `--allow-secrets` — send the file even if the secret scan flags it
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { confirm, isCancel, log } from "@clack/prompts";
import { FileIndexManager, TokenCounter } from "@dev-session/core";
import {
	AtomicWriter,
	CliError,
	PathValidator,
	SecretScanner,
	type ValidatedPath,
} from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default model for compaction (cheapest Haiku-class). */
const DEFAULT_COMPACT_MODEL = "claude-haiku-4-5-20251001";

/** System prompt for the compaction task. */
const COMPACT_SYSTEM_PROMPT = `You are a technical documentation compactor. Your job is to reduce the token count of a context file while preserving all essential information.

Rules:
- Remove redundant sentences and phrases
- Shorten verbose explanations while preserving meaning
- Preserve all code examples, file paths, type names, and specific values exactly
- Keep all headings and structural elements intact
- Do NOT add new information
- Do NOT use markdown formatting if it wasn't already present
- Output ONLY the compacted content — no preamble, no commentary`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from Commander to the compact action. */
export interface CompactOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Print compacted version to stdout without writing. */
	readonly dryRun: boolean;
	/** Model to use for compaction (overrides default). */
	readonly model?: string;
	/** Skip confirmation prompt. */
	readonly yes: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Send the file to the API even if the pre-flight secret scan flags it. */
	readonly allowSecrets: boolean;
}

/** Result of a compact run. */
export interface CompactResult {
	/** The file that was compacted. */
	readonly filepath: string;
	/** Token count before compaction. */
	readonly tokensBefore: number;
	/** Token count after compaction. */
	readonly tokensAfter: number;
	/** Lines before compaction. */
	readonly linesBefore: number;
	/** Lines after compaction. */
	readonly linesAfter: number;
	/** Path to the backup file (if written). */
	readonly backupPath?: string;
	/** Whether this was a dry run. */
	readonly dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Creates a timestamped backup of a file in `.session/backups/`.
 *
 * @param sessionDir - Validated path to `.session/`.
 * @param filepath - Relative path from project root.
 * @param content - Content to back up.
 * @returns Absolute path to the backup file.
 */
function createBackup(sessionDir: ValidatedPath, filepath: string, content: string): string {
	const backupsDir = path.join(sessionDir, "backups");
	if (!fs.existsSync(backupsDir)) {
		fs.mkdirSync(backupsDir, { recursive: true, mode: 0o755 });
	}

	const basename = path.basename(filepath);
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
	const backupFilename = `${basename}.${timestamp}`;
	const backupPath = path.join(backupsDir, backupFilename) as ValidatedPath;

	AtomicWriter.writeFile(backupPath, content);
	return backupPath;
}

/**
 * Scans content for secrets before it is sent to the Anthropic API.
 *
 * `WriteGuard` protects content on the way to disk; nothing protected content
 * on the way out over the network. This closes that gap: a flagged file is
 * refused rather than uploaded, and the caller must pass `--allow-secrets` to
 * override. Only redacted matches are ever printed.
 *
 * @param content - The file content about to be sent.
 * @param relativePath - Project-relative path, for the error message.
 * @param allowSecrets - When `true`, warn instead of refusing.
 * @throws {CliError} If secrets are detected and `allowSecrets` is `false`.
 */
function guardEgress(content: string, relativePath: string, allowSecrets: boolean): void {
	const findings = SecretScanner.scan(content);
	if (findings.length === 0) {
		return;
	}

	const detail = findings
		.map((f) => `  line ${String(f.line)}: ${f.pattern} (${f.redacted})`)
		.join("\n");

	if (allowSecrets) {
		log.warn(
			`Sending ${String(findings.length)} possible secret(s) to the API (--allow-secrets):\n${detail}`,
		);
		return;
	}

	throw new CliError({
		message:
			`Refusing to send "${relativePath}" to the Anthropic API — ` +
			`${String(findings.length)} possible secret(s) detected:\n${detail}`,
		suggestion:
			"Remove the secrets from the file, or re-run with --allow-secrets if these are false positives.",
	});
}

/**
 * Calls the Anthropic API to compact a file's content.
 *
 * @param content - The original file content.
 * @param model - The model to use.
 * @param apiKey - The Anthropic API key.
 * @returns The compacted content string.
 * @throws CliError if the API call fails.
 */
async function callAnthropicCompact(
	content: string,
	model: string,
	apiKey: string,
): Promise<string> {
	// Dynamic import to avoid bundling the SDK when not needed
	const { default: Anthropic } = await import("@anthropic-ai/sdk");
	const client = new Anthropic({ apiKey });

	let response: { content: Array<{ type: string; text?: string }> };
	try {
		response = await client.messages.create({
			model,
			max_tokens: 8192,
			system: COMPACT_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: `Compact the following context file:\n\n${content}`,
				},
			],
		});
	} catch (cause: unknown) {
		throw new CliError({
			message: "Anthropic API call failed during compaction",
			suggestion: "Check your ANTHROPIC_API_KEY and network connection.",
			cause,
		});
	}

	const firstBlock = response.content[0];
	if (firstBlock === undefined || firstBlock.type !== "text" || firstBlock.text === undefined) {
		throw new CliError({
			message: "Unexpected response from Anthropic API — no text content returned",
			suggestion: "Try again or use a different model with --model.",
		});
	}

	return firstBlock.text;
}

/**
 * Executes the compact command.
 *
 * @param filePath - Relative or absolute path to the file to compact.
 * @param options - Resolved CLI options.
 * @returns Compact result summary.
 */
export async function runCompact(
	filePath: string,
	options: CompactOptions,
): Promise<CompactResult> {
	// Validate API key before anything else
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (apiKey === undefined || apiKey.trim().length === 0) {
		throw new CliError({
			message: "ANTHROPIC_API_KEY is not set",
			suggestion:
				"Export your Anthropic API key: export ANTHROPIC_API_KEY=sk-ant-...\n" +
				"Get a key at https://console.anthropic.com/",
		});
	}

	const sessionDir = resolveSessionDir(options.cwd);

	// Resolve and validate the file path
	const resolvedPath = PathValidator.safeResolvePath(filePath, options.cwd);
	const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(options.cwd, filePath);
	const relativePath = path.relative(options.cwd, absolutePath);

	if (!fs.existsSync(absolutePath)) {
		throw new CliError({
			message: `File not found: ${relativePath}`,
			suggestion: "Provide a path to a file that exists in the project.",
		});
	}

	let originalContent: string;
	try {
		originalContent = fs.readFileSync(absolutePath, "utf-8");
	} catch (cause: unknown) {
		throw new CliError({
			message: "Failed to read file for compaction",
			suggestion: "Check that the file has read permissions.",
			cause,
		});
	}

	if (originalContent.trim().length === 0) {
		throw new CliError({
			message: "File is empty — nothing to compact",
		});
	}

	guardEgress(originalContent, relativePath, options.allowSecrets);

	const counter = TokenCounter.create();
	const tokensBefore = (await counter.countString(originalContent)).tokens;
	const linesBefore = originalContent.split("\n").length;

	const model = options.model ?? DEFAULT_COMPACT_MODEL;

	if (options.verbose) {
		log.info(`Compacting "${relativePath}" using model: ${model}`);
		log.info(`Original: ${String(linesBefore)} lines, ~${String(tokensBefore)} tokens`);
	}

	log.info(`Calling ${model} to compact…`);
	const compactedContent = await callAnthropicCompact(originalContent, model, apiKey);

	const tokensAfter = (await counter.countString(compactedContent)).tokens;
	const linesAfter = compactedContent.split("\n").length;
	const tokenSavings = tokensBefore - tokensAfter;
	const savingsPct = tokensBefore > 0 ? Math.round((tokenSavings / tokensBefore) * 100) : 0;

	// Dry run — print and return
	if (options.dryRun) {
		log.info(
			`Dry run: ${String(linesBefore)} → ${String(linesAfter)} lines, ` +
				`~${String(tokensBefore)} → ~${String(tokensAfter)} tokens (${String(savingsPct)}% savings)`,
		);
		process.stdout.write("\n── Compacted content ─────────────────────────────────────\n\n");
		process.stdout.write(compactedContent);
		process.stdout.write("\n──────────────────────────────────────────────────────────\n");

		return {
			filepath: relativePath,
			tokensBefore,
			tokensAfter,
			linesBefore,
			linesAfter,
			dryRun: true,
		};
	}

	// Confirm before writing
	log.info(
		`Before: ${String(linesBefore)} lines, ~${String(tokensBefore)} tokens\n` +
			`After:  ${String(linesAfter)} lines, ~${String(tokensAfter)} tokens (${String(savingsPct)}% savings)`,
	);

	if (!options.yes) {
		const confirmed = await confirm({
			message: `Write compacted content to "${relativePath}"? (original backed up)`,
		});

		if (isCancel(confirmed) || !confirmed) {
			log.info("Compaction cancelled — no changes written.");
			return {
				filepath: relativePath,
				tokensBefore,
				tokensAfter,
				linesBefore,
				linesAfter,
				dryRun: false,
			};
		}
	}

	// Backup original
	const backupPath = createBackup(sessionDir, relativePath, originalContent);

	if (options.verbose) {
		log.info(`Backed up original to: ${path.relative(options.cwd, backupPath)}`);
	}

	AtomicWriter.writeFile(resolvedPath, compactedContent);

	// Update FileIndexEntry.token_cost
	const allEntries = FileIndexManager.load(sessionDir);
	const entryIndex = allEntries.findIndex((e) => e.filepath === relativePath);
	if (entryIndex >= 0) {
		const updatedEntry = {
			...(allEntries[entryIndex] as (typeof allEntries)[number]),
			token_cost: tokensAfter,
		};
		const updatedEntries = [
			...allEntries.slice(0, entryIndex),
			updatedEntry,
			...allEntries.slice(entryIndex + 1),
		];
		FileIndexManager.save(sessionDir, updatedEntries);

		if (options.verbose) {
			log.info(`Updated FILE_INDEX token_cost for "${relativePath}": ${String(tokensAfter)}`);
		}
	}

	log.success(
		`Compacted "${relativePath}": saved ~${String(tokenSavings)} tokens (${String(savingsPct)}%).`,
	);

	return {
		filepath: relativePath,
		tokensBefore,
		tokensAfter,
		linesBefore,
		linesAfter,
		backupPath: path.relative(options.cwd, backupPath),
		dryRun: false,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve and validate the .session/ directory path.
 *
 * @param cwd - Working directory
 * @returns ValidatedPath to .session/
 * @throws CliError if .session/ does not exist
 */
function resolveSessionDir(cwd: string): ValidatedPath {
	const sessionDir = path.join(cwd, ".session");

	if (!fs.existsSync(sessionDir)) {
		throw new CliError({
			message: "No .session/ directory found",
			suggestion: "Run `dev-sesssion init` first to initialize the project.",
		});
	}

	return PathValidator.safeResolvePath(".session", cwd);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `compact <file>` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerCompactCommand(program: Command): void {
	program
		.command("compact <file>")
		.description("AI-compact a context file to reduce its token count (requires ANTHROPIC_API_KEY)")
		.option("--model <id>", `Model to use (default: ${DEFAULT_COMPACT_MODEL})`)
		.option("--allow-secrets", "Send the file even if the pre-flight secret scan flags it", false)
		.action(async (file: string, cmdOptions: { model?: string; allowSecrets?: boolean }) => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				verbose: boolean;
				dryRun: boolean;
			}>();

			const compactOptions: CompactOptions = {
				cwd: opts.cwd,
				dryRun: opts.dryRun,
				yes: opts.yes,
				verbose: opts.verbose,
				allowSecrets: cmdOptions.allowSecrets ?? false,
				...(cmdOptions.model !== undefined ? { model: cmdOptions.model } : {}),
			};

			try {
				await runCompact(file, compactOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
