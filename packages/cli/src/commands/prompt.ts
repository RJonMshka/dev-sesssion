/**
 * `dev-sesssion prompt` command.
 *
 * Prints the contents of NEXT_PROMPT.md to stdout for piping or copying.
 * Supports a `--copy` flag that copies to the system clipboard using
 * platform-native commands (pbcopy on macOS, xclip/xsel on Linux,
 * clip.exe on Windows).
 *
 * @module
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "@clack/prompts";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from Commander to the prompt action. */
export interface PromptOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Copy prompt to system clipboard. */
	readonly copy: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute the prompt command.
 *
 * @param options - Resolved CLI options
 * @returns The prompt content string
 * @throws CliError if no session or NEXT_PROMPT.md found
 */
export async function runPrompt(options: PromptOptions): Promise<string> {
	const sessionDir = resolveSessionDir(options.cwd);
	const promptPath = path.join(sessionDir, "NEXT_PROMPT.md");

	if (!fs.existsSync(promptPath)) {
		throw new CliError({
			message: "No NEXT_PROMPT.md found",
			suggestion: "Run `dev-sesssion init` or `dev-sesssion update` to generate a prompt.",
		});
	}

	const content = fs.readFileSync(promptPath, "utf-8");

	if (options.copy) {
		const copied = await copyToClipboard(content);
		if (copied) {
			log.success("Copied to clipboard.");
		} else {
			log.warn("Could not copy to clipboard — printing to stdout instead.");
			process.stdout.write(content);
		}
	} else {
		process.stdout.write(content);
	}

	return content;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Copy text to the system clipboard using platform-native commands.
 *
 * @param text - The text to copy
 * @returns true if copied successfully, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	const platform = process.platform;

	let cmd: string;
	let args: readonly string[];

	if (platform === "darwin") {
		cmd = "pbcopy";
		args = [];
	} else if (platform === "win32") {
		cmd = "clip";
		args = [];
	} else {
		// Linux — try xclip first, then xsel
		cmd = "xclip";
		args = ["-selection", "clipboard"];
	}

	try {
		const child = execFile(cmd, args as string[]);
		if (child.stdin) {
			child.stdin.write(text);
			child.stdin.end();
		}
		await new Promise<void>((resolve, reject) => {
			child.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`${cmd} exited with code ${String(code)}`));
				}
			});
			child.on("error", reject);
		});
		return true;
	} catch {
		// If xclip failed on Linux, try xsel
		if (platform === "linux" && cmd === "xclip") {
			try {
				const child = execFile("xsel", ["--clipboard", "--input"]);
				if (child.stdin) {
					child.stdin.write(text);
					child.stdin.end();
				}
				await new Promise<void>((resolve, reject) => {
					child.on("close", (code) => {
						if (code === 0) {
							resolve();
						} else {
							reject(new Error(`xsel exited with code ${String(code)}`));
						}
					});
					child.on("error", reject);
				});
				return true;
			} catch {
				return false;
			}
		}
		return false;
	}
}

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

/**
 * Register the `prompt` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerPromptCommand(program: Command): void {
	program
		.command("prompt")
		.description("Print NEXT_PROMPT.md to stdout (for piping or copying)")
		.option("--copy", "Copy to system clipboard", false)
		.action(async (cmdOptions: { copy?: boolean }) => {
			const opts = program.opts<{ cwd: string }>();

			const promptOptions: PromptOptions = {
				cwd: opts.cwd,
				copy: cmdOptions.copy ?? false,
			};

			try {
				await runPrompt(promptOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
