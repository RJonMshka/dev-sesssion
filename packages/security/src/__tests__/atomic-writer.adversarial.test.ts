/**
 * Adversarial tests for AtomicWriter.
 *
 * Tests atomicity guarantees, WriteGuard integration under adversarial
 * conditions, permission enforcement, and partial write recovery.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecurityError } from "../errors/security-error.js";
import type { ValidatedPath } from "../validators/path-validator.js";
import { AtomicWriter } from "../writers/atomic-writer.js";

function createTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "atomic-adv-test-"));
}

function asValidatedPath(p: string): ValidatedPath {
	return p as ValidatedPath;
}

describe("AtomicWriter — adversarial tests", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = createTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("atomicity — original file not corrupted on failure", () => {
		it("preserves original content if write to nonexistent directory fails", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "existing.txt"));
			fs.writeFileSync(filePath, "original content");

			// Try to write to a path where the parent directory doesn't exist
			const badPath = asValidatedPath(path.join(tmpDir, "nonexistent", "deep", "file.txt"));
			try {
				AtomicWriter.writeFile(badPath, "new content");
			} catch {
				// Expected to fail
			}

			// Original file should be untouched
			expect(fs.readFileSync(filePath, "utf8")).toBe("original content");
		});

		it("does not leave orphaned .tmp files after failure", () => {
			const badPath = asValidatedPath(path.join(tmpDir, "nonexistent", "file.txt"));
			try {
				AtomicWriter.writeFile(badPath, "content");
			} catch {
				// Expected
			}

			// Check no .tmp files exist in tmpDir
			const files = fs.readdirSync(tmpDir);
			const tmpFiles = files.filter((f) => f.endsWith(".tmp") || f.includes("."));
			// The only file should be "existing.txt" if it exists, no tmp files
			for (const f of tmpFiles) {
				expect(f).not.toMatch(/\.[0-9a-f]+$/);
			}
		});
	});

	describe("strict mode blocks secrets from being written", () => {
		it("does NOT write file when strict mode detects a secret", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "blocked.txt"));
			try {
				AtomicWriter.writeFile(filePath, "AKIAIOSFODNN7EXAMPLE", {
					guard: { strict: true },
				});
			} catch {
				// Expected SecurityError
			}

			// File must NOT exist — strict mode should have prevented the write
			expect(fs.existsSync(filePath)).toBe(false);
		});

		it("throws SecurityError (not generic Error) in strict mode", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "blocked.txt"));
			expect(() =>
				AtomicWriter.writeFile(filePath, "-----BEGIN RSA PRIVATE KEY-----\nMIIE...", {
					guard: { strict: true },
				}),
			).toThrow(SecurityError);
		});

		it("does NOT write file for private key content in strict mode", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "key.pem"));
			try {
				AtomicWriter.writeFile(filePath, "-----BEGIN RSA PRIVATE KEY-----\nMIIE...", {
					guard: { strict: true },
				});
			} catch {
				// Expected
			}
			expect(fs.existsSync(filePath)).toBe(false);
		});
	});

	describe("warn mode still writes despite secrets", () => {
		it("writes file content even when secrets are detected", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "warned.txt"));
			const content = "AKIAIOSFODNN7EXAMPLE";
			const result = AtomicWriter.writeFile(filePath, content);

			expect(result.warnings.length).toBeGreaterThan(0);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});

		it("returns warnings with correct pattern info", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "warned.txt"));
			const result = AtomicWriter.writeFile(filePath, "AKIAIOSFODNN7EXAMPLE");

			expect(result.warnings[0]?.pattern).toBe("AWS Access Key");
			expect(result.warnings[0]?.line).toBe(1);
			expect(result.warnings[0]?.redacted).toContain("*");
		});
	});

	describe("bypass comment allows writing secrets", () => {
		it("writes secret content with bypass in warn mode", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "bypassed.txt"));
			const content = "<!-- dev-session:allow -->\nAKIAIOSFODNN7EXAMPLE";
			const result = AtomicWriter.writeFile(filePath, content);

			expect(result.warnings).toEqual([]);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});

		it("writes secret content with bypass in strict mode", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "bypassed-strict.txt"));
			const content = "<!-- dev-session:allow -->\n-----BEGIN RSA PRIVATE KEY-----";
			const result = AtomicWriter.writeFile(filePath, content, {
				guard: { strict: true },
			});

			expect(result.warnings).toEqual([]);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});
	});

	describe("skipGuard bypasses all scanning", () => {
		it("writes secret content without scanning when skipGuard is true", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "skipped.txt"));
			const content = "AKIAIOSFODNN7EXAMPLE\n-----BEGIN RSA PRIVATE KEY-----";
			const result = AtomicWriter.writeFile(filePath, content, { skipGuard: true });

			expect(result.warnings).toEqual([]);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});

		it("skipGuard overrides even strict mode guard option", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "skipped-strict.txt"));
			const content = "AKIAIOSFODNN7EXAMPLE";
			// skipGuard should take priority over strict mode
			const result = AtomicWriter.writeFile(filePath, content, {
				skipGuard: true,
				guard: { strict: true },
			});

			expect(result.warnings).toEqual([]);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});
	});

	describe("file permissions", () => {
		it("creates files with 0o644 by default", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "default-perms.txt"));
			AtomicWriter.writeFile(filePath, "content");

			const stats = fs.statSync(filePath);
			expect(stats.mode & 0o777).toBe(0o644);
		});

		it("respects custom mode option", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "custom-perms.txt"));
			AtomicWriter.writeFile(filePath, "secret content", { mode: 0o600 });

			const stats = fs.statSync(filePath);
			expect(stats.mode & 0o777).toBe(0o600);
		});

		it("does not create world-writable files", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "safe-perms.txt"));
			AtomicWriter.writeFile(filePath, "content");

			const stats = fs.statSync(filePath);
			const worldWritable = stats.mode & 0o002;
			expect(worldWritable).toBe(0);
		});
	});

	describe("async writeFileAsync — adversarial", () => {
		it("strict mode blocks async writes too", async () => {
			const filePath = asValidatedPath(path.join(tmpDir, "async-blocked.txt"));
			await expect(
				AtomicWriter.writeFileAsync(filePath, "AKIAIOSFODNN7EXAMPLE", {
					guard: { strict: true },
				}),
			).rejects.toThrow(SecurityError);
			expect(fs.existsSync(filePath)).toBe(false);
		});

		it("bypass works in async mode", async () => {
			const filePath = asValidatedPath(path.join(tmpDir, "async-bypass.txt"));
			const content = "<!-- dev-session:allow -->\nAKIAIOSFODNN7EXAMPLE";
			const result = await AtomicWriter.writeFileAsync(filePath, content, {
				guard: { strict: true },
			});
			expect(result.warnings).toEqual([]);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});

		it("reports warnings in async warn mode", async () => {
			const filePath = asValidatedPath(path.join(tmpDir, "async-warn.txt"));
			const result = await AtomicWriter.writeFileAsync(filePath, "AKIAIOSFODNN7EXAMPLE");
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(fs.readFileSync(filePath, "utf8")).toBe("AKIAIOSFODNN7EXAMPLE");
		});
	});

	describe("large file handling", () => {
		it("writes large content atomically", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "large.txt"));
			const content = "x".repeat(1024 * 1024); // 1MB
			const result = AtomicWriter.writeFile(filePath, content);

			expect(result.bytesWritten).toBe(1024 * 1024);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});
	});
});
