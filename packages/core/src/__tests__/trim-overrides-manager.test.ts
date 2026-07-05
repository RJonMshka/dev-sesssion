import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrimOverridesManager } from "../managers/trim-overrides-manager.js";

function makeTmpSessionDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trim-overrides-"));
	// Simulate .session/ directory
	return dir;
}

function asValidated(p: string): ValidatedPath {
	return p as ValidatedPath;
}

describe("TrimOverridesManager", () => {
	let sessionDir: ValidatedPath;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpSessionDir();
		sessionDir = asValidated(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// load

	describe("load", () => {
		it("returns null when no trim-overrides.json exists", () => {
			const result = TrimOverridesManager.load(sessionDir);
			expect(result).toBeNull();
		});

		it("loads a valid trim-overrides.json", () => {
			const data = {
				session_id: "test-session",
				created_at: "2026-04-10T12:00:00.000Z",
				updated_at: "2026-04-10T12:00:00.000Z",
				excluded_files: [
					{
						filepath: "packages/cli/src/big-file.ts",
						excluded_at: "2026-04-10T12:00:00.000Z",
					},
				],
			};
			fs.writeFileSync(path.join(tmpDir, "trim-overrides.json"), JSON.stringify(data));

			const result = TrimOverridesManager.load(sessionDir);
			expect(result).not.toBeNull();
			expect(result?.session_id).toBe("test-session");
			expect(result?.excluded_files).toHaveLength(1);
			expect(result?.excluded_files[0]?.filepath).toBe("packages/cli/src/big-file.ts");
		});

		it("throws ParseError on invalid JSON", () => {
			fs.writeFileSync(path.join(tmpDir, "trim-overrides.json"), "not-json{{{");
			expect(() => TrimOverridesManager.load(sessionDir)).toThrow();
		});

		it("throws ParseError on schema mismatch", () => {
			fs.writeFileSync(
				path.join(tmpDir, "trim-overrides.json"),
				JSON.stringify({ unexpected: true }),
			);
			expect(() => TrimOverridesManager.load(sessionDir)).toThrow();
		});
	});

	// addExclusion / isExcluded

	describe("addExclusion", () => {
		it("creates the file if it does not exist", () => {
			TrimOverridesManager.addExclusion(sessionDir, "my-session", "src/big.ts");
			const result = TrimOverridesManager.load(sessionDir);
			expect(result).not.toBeNull();
			expect(result?.excluded_files).toHaveLength(1);
		});

		it("adds a new exclusion to an existing file", () => {
			TrimOverridesManager.addExclusion(sessionDir, "my-session", "a.ts");
			TrimOverridesManager.addExclusion(sessionDir, "my-session", "b.ts");
			const result = TrimOverridesManager.load(sessionDir);
			expect(result?.excluded_files).toHaveLength(2);
		});

		it("is idempotent — adding same filepath twice does not duplicate", () => {
			TrimOverridesManager.addExclusion(sessionDir, "my-session", "a.ts");
			TrimOverridesManager.addExclusion(sessionDir, "my-session", "a.ts");
			const result = TrimOverridesManager.load(sessionDir);
			expect(result?.excluded_files).toHaveLength(1);
		});

		it("stores the optional reason field", () => {
			TrimOverridesManager.addExclusion(sessionDir, "my-session", "a.ts", "too large");
			const result = TrimOverridesManager.load(sessionDir);
			expect(result?.excluded_files[0]?.reason).toBe("too large");
		});
	});

	describe("isExcluded", () => {
		it("returns false when overrides is null", () => {
			expect(TrimOverridesManager.isExcluded(null, "any.ts")).toBe(false);
		});

		it("returns true for an excluded filepath", () => {
			TrimOverridesManager.addExclusion(sessionDir, "session", "excluded.ts");
			const overrides = TrimOverridesManager.load(sessionDir);
			expect(TrimOverridesManager.isExcluded(overrides, "excluded.ts")).toBe(true);
		});

		it("returns false for a non-excluded filepath", () => {
			TrimOverridesManager.addExclusion(sessionDir, "session", "excluded.ts");
			const overrides = TrimOverridesManager.load(sessionDir);
			expect(TrimOverridesManager.isExcluded(overrides, "other.ts")).toBe(false);
		});
	});

	// removeExclusion

	describe("removeExclusion", () => {
		it("returns null when no overrides file exists", () => {
			const result = TrimOverridesManager.removeExclusion(sessionDir, "a.ts");
			expect(result).toBeNull();
		});

		it("removes the specified filepath from exclusions", () => {
			TrimOverridesManager.addExclusion(sessionDir, "session", "a.ts");
			TrimOverridesManager.addExclusion(sessionDir, "session", "b.ts");
			TrimOverridesManager.removeExclusion(sessionDir, "a.ts");
			const result = TrimOverridesManager.load(sessionDir);
			expect(result?.excluded_files).toHaveLength(1);
			expect(result?.excluded_files[0]?.filepath).toBe("b.ts");
		});
	});

	// clear

	describe("clear", () => {
		it("deletes the trim-overrides.json file", () => {
			TrimOverridesManager.addExclusion(sessionDir, "session", "a.ts");
			TrimOverridesManager.clear(sessionDir);
			const result = TrimOverridesManager.load(sessionDir);
			expect(result).toBeNull();
		});

		it("is a no-op when file does not exist", () => {
			expect(() => TrimOverridesManager.clear(sessionDir)).not.toThrow();
		});
	});

	// getExcludedPaths

	describe("getExcludedPaths", () => {
		it("returns empty array for null overrides", () => {
			expect(TrimOverridesManager.getExcludedPaths(null)).toEqual([]);
		});

		it("returns all excluded paths as strings", () => {
			TrimOverridesManager.addExclusion(sessionDir, "session", "a.ts");
			TrimOverridesManager.addExclusion(sessionDir, "session", "b.ts");
			const overrides = TrimOverridesManager.load(sessionDir);
			const paths = TrimOverridesManager.getExcludedPaths(overrides);
			expect(paths).toContain("a.ts");
			expect(paths).toContain("b.ts");
			expect(paths).toHaveLength(2);
		});
	});
});
