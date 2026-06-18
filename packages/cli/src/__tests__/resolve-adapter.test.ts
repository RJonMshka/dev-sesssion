import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CliError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAdapter } from "../utils/resolve-adapter.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-adapter-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveAdapter", () => {
	describe("explicit --adapter flag", () => {
		it.each(["claude", "opencode", "cursor", "windsurf"])("resolves '%s' from the flag", (name) => {
			const result = resolveAdapter(tmpDir, name);
			expect(result.source).toBe("flag");
			expect(result.tool).toBe(name);
			expect(result.adapter.config.name).toBe(name);
		});

		it("throws CliError for an unrecognized adapter name", () => {
			expect(() => resolveAdapter(tmpDir, "zed")).toThrow(CliError);
		});

		it("lists windsurf as a valid adapter in the error suggestion", () => {
			try {
				resolveAdapter(tmpDir, "zed");
				expect.unreachable("should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(CliError);
				expect((error as CliError).suggestion).toContain("windsurf");
			}
		});

		it("takes precedence over project files on disk", () => {
			// A .cursorrules file would auto-detect cursor, but the flag wins.
			fs.writeFileSync(path.join(tmpDir, ".cursorrules"), "# rules");
			const result = resolveAdapter(tmpDir, "windsurf");
			expect(result.source).toBe("flag");
			expect(result.tool).toBe("windsurf");
		});
	});

	describe("auto-detection", () => {
		it("detects windsurf from .windsurfrules", () => {
			fs.writeFileSync(path.join(tmpDir, ".windsurfrules"), "# rules");
			const result = resolveAdapter(tmpDir);
			expect(result.source).toBe("detect");
			expect(result.tool).toBe("windsurf");
			expect(result.adapter.config.name).toBe("windsurf");
		});
	});

	describe("fallback", () => {
		it("falls back to the plain adapter when nothing is detected", () => {
			const result = resolveAdapter(tmpDir);
			expect(result.source).toBe("fallback");
			expect(result.tool).toBe("unknown");
			expect(result.adapter.config.name).toBe("plain");
		});
	});
});
