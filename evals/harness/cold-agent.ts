/**
 * Sandboxed cold-agent runner.
 *
 * Runs a fresh agent against a workspace with a deliberately narrow tool
 * surface. The agent is blocked from reading `.session/` and the adapter file
 * in *both* arms, so the only difference between the bootstrap and control arms
 * is the generated context injected into the prompt. Without that block the
 * control agent could simply read the session files and the arms would collapse
 * into the same condition.
 *
 * The Claude Agent SDK is deliberately not used here: it auto-loads CLAUDE.md
 * and has unrestricted filesystem access, which would contaminate arm separation.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

/** Model under evaluation as the coding agent. */
const AGENT_MODEL = "claude-opus-5";

/** Hard ceiling on agent turns, so a confused run cannot spend unbounded tokens. */
const MAX_TURNS = 24;

/** Workspace-relative prefixes the agent may never read. */
const DENIED = [".session", ".git", "CLAUDE.md", ".cursorrules", ".windsurfrules", "AGENTS.md"];

/** Outcome of one cold-agent run. */
export interface ColdAgentRun {
	readonly arm: "bootstrap" | "control";
	readonly turns: number;
	/** Workspace-relative paths the agent created or modified. */
	readonly filesWritten: readonly string[];
	/** Files the agent chose to read — the signal for context efficiency. */
	readonly filesRead: readonly string[];
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly stoppedBecause: string;
}

/** Tool surface handed to the agent. */
const TOOLS: Anthropic.Tool[] = [
	{
		name: "list_files",
		description: "List repo-relative file paths in the project, recursively.",
		input_schema: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
	},
	{
		name: "read_file",
		description: "Read a UTF-8 text file by repo-relative path.",
		input_schema: {
			type: "object",
			properties: { path: { type: "string", description: "Repo-relative path." } },
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "write_file",
		description: "Create or overwrite a UTF-8 text file at a repo-relative path.",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Repo-relative path." },
				content: { type: "string", description: "Full file contents." },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
	},
];

/**
 * Resolves a repo-relative path inside the workspace, refusing escapes.
 *
 * @param workspaceDir - Absolute workspace root.
 * @param rel - Untrusted repo-relative path from the model.
 * @returns The absolute path.
 * @throws {Error} If the path escapes the workspace or targets a denied area.
 */
function resolveInside(workspaceDir: string, rel: string): string {
	if (rel.includes("\0")) throw new Error("path contains a null byte");
	const abs = path.resolve(workspaceDir, rel);
	const root = path.resolve(workspaceDir);
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		throw new Error("path escapes the project root");
	}
	const relNorm = path.relative(root, abs).split(path.sep).join("/");
	if (DENIED.some((d) => relNorm === d || relNorm.startsWith(`${d}/`))) {
		throw new Error(`path ${relNorm} is not available in this environment`);
	}
	return abs;
}

/**
 * Recursively lists workspace files, skipping build output and denied areas.
 *
 * @param workspaceDir - Absolute workspace root.
 * @returns Repo-relative paths, sorted.
 */
export async function listFiles(workspaceDir: string): Promise<string[]> {
	const out: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			const rel = path.relative(workspaceDir, abs).split(path.sep).join("/");
			if (DENIED.some((d) => rel === d || rel.startsWith(`${d}/`))) continue;
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			if (entry.isDirectory()) await walk(abs);
			else if (entry.isFile()) out.push(rel);
		}
	};
	await walk(workspaceDir);
	return out.sort();
}

/** Shared instruction — identical across arms. */
const SYSTEM_PROMPT = [
	"You are a software engineer working in an existing TypeScript project.",
	"Use the tools to inspect the project and implement the requested task.",
	"Match the surrounding code's conventions, imports, and error-handling style exactly.",
	"Write real, complete implementations — never placeholders or TODOs.",
	"When the task is complete, reply with a one-line summary and stop.",
].join(" ");

/**
 * Runs one cold-agent attempt.
 *
 * @param opts - Workspace, task text, and the bootstrap context (null = control arm).
 * @returns What the agent did.
 * @throws {Error} If the API call fails outright.
 */
export async function runColdAgent(opts: {
	readonly workspaceDir: string;
	readonly task: string;
	readonly bootstrap: string | null;
}): Promise<ColdAgentRun> {
	const client = new Anthropic();
	const arm: "bootstrap" | "control" = opts.bootstrap === null ? "control" : "bootstrap";

	const opening =
		opts.bootstrap === null
			? `Task: ${opts.task}`
			: [
					"Resuming a previous session. This is the entire context you were handed:",
					"",
					"---",
					opts.bootstrap.trim(),
					"---",
					"",
					`Task: ${opts.task}`,
				].join("\n");

	const messages: Anthropic.MessageParam[] = [{ role: "user", content: opening }];
	const filesWritten = new Set<string>();
	const filesRead = new Set<string>();
	let inputTokens = 0;
	let outputTokens = 0;
	let turns = 0;
	let stoppedBecause = "max_turns";

	while (turns < MAX_TURNS) {
		turns += 1;
		const res = await client.messages.create({
			model: AGENT_MODEL,
			max_tokens: 16000,
			thinking: { type: "adaptive" },
			output_config: { effort: "high" },
			system: SYSTEM_PROMPT,
			tools: TOOLS,
			messages,
		});
		inputTokens += res.usage.input_tokens;
		outputTokens += res.usage.output_tokens;
		messages.push({ role: "assistant", content: res.content });

		if (res.stop_reason !== "tool_use") {
			stoppedBecause = res.stop_reason ?? "unknown";
			break;
		}

		const results: Anthropic.ToolResultBlockParam[] = [];
		for (const block of res.content) {
			if (block.type !== "tool_use") continue;
			const input = block.input as Record<string, unknown>;
			try {
				let text: string;
				if (block.name === "list_files") {
					text = (await listFiles(opts.workspaceDir)).join("\n");
				} else if (block.name === "read_file") {
					const rel = String(input.path ?? "");
					text = await fs.readFile(resolveInside(opts.workspaceDir, rel), "utf8");
					filesRead.add(rel);
				} else if (block.name === "write_file") {
					const rel = String(input.path ?? "");
					const abs = resolveInside(opts.workspaceDir, rel);
					await fs.mkdir(path.dirname(abs), { recursive: true });
					await fs.writeFile(abs, String(input.content ?? ""), "utf8");
					filesWritten.add(rel);
					text = `wrote ${rel}`;
				} else {
					throw new Error(`unknown tool ${block.name}`);
				}
				results.push({ type: "tool_result", tool_use_id: block.id, content: text });
			} catch (err: unknown) {
				results.push({
					type: "tool_result",
					tool_use_id: block.id,
					content: err instanceof Error ? err.message : String(err),
					is_error: true,
				});
			}
		}
		messages.push({ role: "user", content: results });
	}

	return {
		arm,
		turns,
		filesWritten: [...filesWritten],
		filesRead: [...filesRead],
		inputTokens,
		outputTokens,
		stoppedBecause,
	};
}
