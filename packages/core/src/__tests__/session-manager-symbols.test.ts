/**
 * `SessionManager.symbolsForFile` / `symbolsByName` — the facade over
 * SymbolQuery (LLD-symbols.md, REQ-SYM-12, -16..18).
 *
 * The index is built and saved by the real builder and manager, so what the
 * facade loads is what `dev-sesssion index` writes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CliError, PathValidator, SecurityError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AiIndexManager } from "../annotation/ai-index-manager.js";
import { SessionManager } from "../managers/session-manager.js";

let root: string;

beforeEach(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "symbols-facade-"));
	fs.mkdirSync(path.join(root, ".session"));
	fs.mkdirSync(path.join(root, "src"));
	fs.writeFileSync(
		path.join(root, "src", "nums.ts"),
		"export function first(): number {\n  return 1;\n}\n",
	);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** Builds and saves the index, optionally rewriting its recorded root. */
async function writeIndex(recordedRoot?: string): Promise<void> {
	const validRoot = PathValidator.safeResolvePath(".", root);
	const index = await AiIndexBuilder.fromDirectory(validRoot);
	const sessionDir = PathValidator.safeResolvePath(".session", validRoot);
	AiIndexManager.save(sessionDir, { ...index, project_root: recordedRoot ?? index.project_root });
}

describe("SessionManager symbols facade", () => {
	it("throws a CliError naming `dev-sesssion index` when there is no index (REQ-SYM-12)", () => {
		const mgr = SessionManager.create(root);
		for (const call of [
			() => mgr.symbolsForFile("src/nums.ts"),
			() => mgr.symbolsByName("first"),
		]) {
			expect(call).toThrow(CliError);
			try {
				call();
			} catch (e: unknown) {
				expect((e as CliError).suggestion).toContain("dev-sesssion index");
			}
		}
	});

	it("throws a CliError for a file the index does not hold (REQ-SYM-16)", async () => {
		await writeIndex();
		fs.writeFileSync(path.join(root, "src", "later.ts"), "export const x = 1;\n");
		expect(() => SessionManager.create(root).symbolsForFile("src/later.ts")).toThrow(/not indexed/);
	});

	it("rejects a path outside the project root with a SecurityError (REQ-SYM-17)", async () => {
		await writeIndex();
		expect(() => SessionManager.create(root).symbolsForFile("../x.ts")).toThrow(SecurityError);
	});

	it("finds the entry relative to the root it runs in, not the recorded one (REQ-SYM-18)", async () => {
		await writeIndex(path.join(os.tmpdir(), "somewhere-else-entirely"));
		const report = SessionManager.create(root).symbolsForFile("src/nums.ts");
		expect(report.path).toBe("src/nums.ts");
		expect(report.freshness).toBe("current");
		expect(SessionManager.create(root).symbolsByName("first").matches).toHaveLength(1);
	});
});
