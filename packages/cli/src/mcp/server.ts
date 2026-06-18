/**
 * dev-sesssion MCP server.
 *
 * Exposes the `.session/` state over the Model Context Protocol so an agent can
 * pull context on demand (active chunk, indexed files, layered file renders)
 * instead of having a fixed prompt front-loaded. The server is a transport
 * shell: all behavior comes from the {@link SessionManager} facade in core.
 *
 * @module
 */

import { SessionManager } from "@dev-session/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerSessionTools } from "./tools.js";

/** The MCP server name advertised to clients. */
export const MCP_SERVER_NAME = "dev-sesssion";

/** The MCP server version advertised to clients. */
export const MCP_SERVER_VERSION = "1.0.0";

/** Options for starting the MCP server. */
export interface McpServerOptions {
	/** The project working directory containing `.session/`. */
	readonly cwd: string;
	/** When true, mutating tools (mark_task_done) are rejected. */
	readonly readOnly: boolean;
}

/**
 * Create an MCP server backed by the given session facade.
 *
 * Exposed separately from {@link startStdioServer} so tests can drive the
 * server over an in-memory transport without spawning a process.
 *
 * @param manager - The session facade backing the tools.
 * @returns A configured (not yet connected) MCP server.
 */
export function createMcpServer(manager: SessionManager): McpServer {
	const server = new McpServer({
		name: MCP_SERVER_NAME,
		version: MCP_SERVER_VERSION,
	});
	registerSessionTools(server, manager);
	return server;
}

/**
 * Start the dev-sesssion MCP server over stdio.
 *
 * Resolves the session facade for `options.cwd`, wires the tools, and connects
 * a stdio transport. Resolves once the transport is connected; the process then
 * stays alive serving requests until stdin closes.
 *
 * @param options - Server options.
 * @returns A promise that resolves once the transport is connected.
 * @throws {CliError} If no `.session/` directory exists at `options.cwd`.
 */
export async function startStdioServer(options: McpServerOptions): Promise<void> {
	const manager = SessionManager.create(options.cwd, { readOnly: options.readOnly });
	const server = createMcpServer(manager);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
