import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkPlan, SessionManager } from "@dev-session/core";
import { PathValidator } from "@dev-session/security";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../mcp/server.js";
import { readVersion } from "../read-version.js";

let projectRoot: string;

beforeEach(() => {
	projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
});

afterEach(() => {
	fs.rmSync(projectRoot, { recursive: true, force: true });
});

/** Seed a minimal `.session/` with state, a plan chunk, and a NEXT_PROMPT. */
function seedSession(): void {
	const sessionAbs = path.join(projectRoot, ".session");
	fs.mkdirSync(sessionAbs, { recursive: true });
	fs.writeFileSync(
		path.join(sessionAbs, "PLAN_1.md"),
		`---\nchunk_id: 1\ntitle: "Foundation"\ndepends_on: []\ntasks: []\n---\n\n# Chunk 1\n`,
	);
	fs.writeFileSync(
		path.join(sessionAbs, "SESSION_STATE.md"),
		`---\nactive_chunk: 1\nsession_id: "s1"\nlast_updated: "2026-06-16"\ntasks:\n  - text: "Task A"\n    status: "todo"\nlast_worked_files: []\nnotes: []\ncompleted_chunks: {}\n---\n\n# State\n`,
	);
	fs.writeFileSync(path.join(sessionAbs, "FILE_INDEX.md"), "");
	fs.writeFileSync(path.join(sessionAbs, "NEXT_PROMPT.md"), "Resume here.\n");
}

/**
 * Spin up an MCP server (in-memory transport) over a fixture and return a
 * connected client. The manager is created from the real facade.
 */
async function connectClient(options: { readOnly?: boolean } = {}): Promise<Client> {
	const manager = SessionManager.create(projectRoot, { readOnly: options.readOnly ?? false });
	const server = createMcpServer(manager);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0.0.0" });
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

/** Extract the first text block from a tool-call result. */
function firstText(result: unknown): string {
	const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
	return content[0]?.text ?? "";
}

describe("dev-sesssion MCP server", () => {
	it("advertises the real package version in the handshake (not a hardcoded string)", async () => {
		seedSession();
		const client = await connectClient();
		const info = client.getServerVersion();
		expect(info?.name).toBe("dev-sesssion");
		// Must match the package's actual version, read at runtime — never "1.0.0".
		expect(info?.version).toBe(readVersion());
		await client.close();
	});

	it("advertises the eight session tools, and neither advance nor init (REQ-ORC-4, 5)", async () => {
		seedSession();
		const client = await connectClient();
		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual(
			[
				"check_plan",
				"get_active_chunk",
				"get_next_prompt",
				"list_context_files",
				"mark_task_done",
				"query_index",
				"read_file_layer",
				"read_unit",
			].sort(),
		);
		await client.close();
	});

	it("get_active_chunk returns the active chunk", async () => {
		seedSession();
		const client = await connectClient();
		const result = await client.callTool({ name: "get_active_chunk", arguments: {} });
		const payload = JSON.parse(firstText(result)) as { activeChunk: number; title: string };
		expect(payload.activeChunk).toBe(1);
		expect(payload.title).toBe("Foundation");
		await client.close();
	});

	it("get_next_prompt returns NEXT_PROMPT.md contents", async () => {
		seedSession();
		const client = await connectClient();
		const result = await client.callTool({ name: "get_next_prompt", arguments: {} });
		expect(firstText(result)).toContain("Resume here.");
		await client.close();
	});

	it("rejects a path-traversal argument to read_file_layer", async () => {
		seedSession();
		const client = await connectClient();
		const result = await client.callTool({
			name: "read_file_layer",
			arguments: { path: "../../etc/passwd", layer: 2 },
		});
		expect((result as { isError?: boolean }).isError).toBe(true);
		await client.close();
	});

	it("read_unit returns one unit's source (REQ-UNIT-23)", async () => {
		seedSession();
		fs.mkdirSync(path.join(projectRoot, "src"));
		fs.writeFileSync(
			path.join(projectRoot, "src", "math.ts"),
			"export function addOne(n: number): number {\n  return n + 1;\n}\n\nexport const other = 2;\n",
		);
		const client = await connectClient();
		const result = await client.callTool({
			name: "read_unit",
			arguments: { ref: "src/math.ts#addOne:1-3" },
		});
		const text = firstText(result);
		expect(text).toMatch(/^\/\/ src\/math\.ts#addOne L1-3 /);
		expect(text).toContain("return n + 1;");
		expect(text).not.toContain("other");
		await client.close();
	});

	it("rejects a path-traversal argument to read_unit (REQ-UNIT-25)", async () => {
		seedSession();
		const client = await connectClient();
		const result = await client.callTool({
			name: "read_unit",
			arguments: { ref: "../../etc/passwd#x" },
		});
		expect((result as { isError?: boolean }).isError).toBe(true);
		await client.close();
	});

	it("mark_task_done succeeds in writable mode", async () => {
		seedSession();
		const client = await connectClient();
		const result = await client.callTool({
			name: "mark_task_done",
			arguments: { text: "Task A" },
		});
		const payload = JSON.parse(firstText(result)) as { matched: boolean };
		expect(payload.matched).toBe(true);

		// Persisted to disk.
		const sessionDir = PathValidator.safeResolvePath(".session", projectRoot);
		const state = fs.readFileSync(path.join(sessionDir, "SESSION_STATE.md"), "utf-8");
		expect(state).toContain("done");
		await client.close();
	});

	it("blocks mark_task_done in read-only mode", async () => {
		seedSession();
		const client = await connectClient({ readOnly: true });
		const result = await client.callTool({
			name: "mark_task_done",
			arguments: { text: "Task A" },
		});
		expect((result as { isError?: boolean }).isError).toBe(true);
		expect(firstText(result)).toContain("read-only");
		await client.close();
	});

	it("validates tool arguments (invalid layer is rejected)", async () => {
		seedSession();
		const client = await connectClient();
		const result = await client.callTool({
			name: "read_file_layer",
			arguments: { path: "x.ts", layer: 9 },
		});
		expect((result as { isError?: boolean }).isError).toBe(true);
		await client.close();
	});

	describe("check_plan", () => {
		const PLAN = `# Plan

## Chunk 1 — A

Goal: build a.

Files: \`src/a.ts\`

- [ ] Write src/a.ts

## Notes

- [ ] A task under no chunk
`;

		it("returns the same report as plan check --json, and writes nothing (REQ-ORC-4)", async () => {
			seedSession();
			fs.mkdirSync(path.join(projectRoot, "docs"));
			fs.writeFileSync(path.join(projectRoot, "docs", "plan.md"), PLAN);
			const before = fs.readdirSync(path.join(projectRoot, ".session")).sort();

			const client = await connectClient();
			const result = await client.callTool({
				name: "check_plan",
				arguments: { path: "docs/plan.md" },
			});

			expect((result as { isError?: boolean }).isError).toBeFalsy();
			expect(JSON.parse(firstText(result))).toEqual(checkPlan(PLAN));
			expect(fs.readdirSync(path.join(projectRoot, ".session")).sort()).toEqual(before);
			await client.close();
		});

		it("is marked read-only and works on a read-only server (REQ-ORC-4)", async () => {
			seedSession();
			fs.writeFileSync(path.join(projectRoot, "plan.md"), PLAN);
			const client = await connectClient({ readOnly: true });

			const { tools } = await client.listTools();
			const tool = tools.find((t) => t.name === "check_plan");
			expect(tool?.annotations?.readOnlyHint).toBe(true);

			const result = await client.callTool({ name: "check_plan", arguments: { path: "plan.md" } });
			expect((result as { isError?: boolean }).isError).toBeFalsy();
			await client.close();
		});

		it("rejects a path outside the project, and names a missing file without its absolute path", async () => {
			seedSession();
			const client = await connectClient();

			const outside = await client.callTool({
				name: "check_plan",
				arguments: { path: "../../etc/passwd" },
			});
			expect((outside as { isError?: boolean }).isError).toBe(true);

			const missing = await client.callTool({ name: "check_plan", arguments: { path: "nope.md" } });
			expect((missing as { isError?: boolean }).isError).toBe(true);
			expect(firstText(missing)).toContain("nope.md");
			expect(firstText(missing)).not.toContain(projectRoot);
			await client.close();
		});
	});
});
