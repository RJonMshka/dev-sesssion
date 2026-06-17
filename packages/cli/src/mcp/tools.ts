/**
 * MCP tool registrations for the dev-session server.
 *
 * Each tool is a thin adapter: it validates inbound arguments with Zod (the MCP
 * boundary is untrusted), calls the {@link SessionManager} facade, and formats
 * the result. No business logic or path resolution lives here — that belongs to
 * the facade in `@dev-session/core`.
 *
 * @module
 */

import type { SessionManager } from "@dev-session/core";
import { CliError, ParseError, SecurityError } from "@dev-session/security";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** A minimal MCP tool result with a single text block. */
interface ToolResult {
	content: { type: "text"; text: string }[];
	isError?: boolean;
	// MCP's CallToolResult carries an open index signature for protocol metadata.
	[key: string]: unknown;
}

/** Layer selector shared by `read_file_layer` and `query_index`. */
const layerSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

/**
 * Wrap text in a successful single-block tool result.
 *
 * @param text - The text payload.
 * @returns A tool result.
 */
function ok(text: string): ToolResult {
	return { content: [{ type: "text", text }] };
}

/**
 * Serialize a value to pretty JSON and wrap it in a tool result.
 *
 * @param value - The value to serialize.
 * @returns A tool result with JSON text.
 */
function okJson(value: unknown): ToolResult {
	return ok(JSON.stringify(value, null, 2));
}

/**
 * Convert a thrown error into a sanitized error tool result.
 *
 * Only messages from our typed errors (which never contain absolute paths) are
 * surfaced; anything else is reported generically to avoid leaking internals.
 *
 * @param error - The caught error.
 * @returns A tool result with `isError: true`.
 */
function errorResult(error: unknown): ToolResult {
	const known =
		error instanceof CliError || error instanceof ParseError || error instanceof SecurityError;
	const message = known && error instanceof Error ? error.message : "Internal error";
	return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Register all dev-session session tools on an MCP server.
 *
 * @param server - The MCP server to register tools on.
 * @param manager - The session facade backing the tools.
 */
export function registerSessionTools(server: McpServer, manager: SessionManager): void {
	server.registerTool(
		"get_active_chunk",
		{
			description: "Get the active chunk ID, its title, and its live task list.",
		},
		() => {
			try {
				return okJson(manager.getActiveChunk());
			} catch (error: unknown) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"list_context_files",
		{
			description:
				"List files in FILE_INDEX.md. Optionally filter to a chunk (always-include files are included too).",
			inputSchema: {
				chunk: z.number().int().min(0).optional(),
			},
		},
		(args) => {
			try {
				return okJson(manager.listContextFiles(args.chunk));
			} catch (error: unknown) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"read_file_layer",
		{
			description:
				"Render a file at a context layer: 0 = summary + symbol names, 1 = signatures, 2 = full source.",
			inputSchema: {
				path: z.string().min(1),
				layer: layerSchema,
			},
		},
		(args) => {
			try {
				return ok(manager.readFileLayer(args.path, args.layer));
			} catch (error: unknown) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"query_index",
		{
			description:
				"Query the ai-index by exactly one of: tag, chunk, or layer. Returns matching file entries.",
			inputSchema: {
				tag: z.string().min(1).optional(),
				chunk: z.number().int().min(0).optional(),
				layer: layerSchema.optional(),
			},
		},
		(args) => {
			try {
				const query: { tag?: string; chunk?: number; layer?: 0 | 1 | 2 } = {};
				if (args.tag !== undefined) query.tag = args.tag;
				if (args.chunk !== undefined) query.chunk = args.chunk;
				if (args.layer !== undefined) query.layer = args.layer;
				return okJson(manager.queryIndex(query));
			} catch (error: unknown) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"mark_task_done",
		{
			description:
				"Mark a task done by exact text match in the active chunk. Disabled in read-only mode.",
			inputSchema: {
				text: z.string().min(1),
			},
		},
		(args) => {
			try {
				return okJson(manager.markTaskDone(args.text));
			} catch (error: unknown) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"get_next_prompt",
		{
			description: "Read the raw contents of NEXT_PROMPT.md (the next-session bootstrap).",
		},
		() => {
			try {
				return ok(manager.getNextPrompt());
			} catch (error: unknown) {
				return errorResult(error);
			}
		},
	);
}
