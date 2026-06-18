import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecurityError } from "../errors/security-error.js";
import type { ValidatedPath } from "../validators/path-validator.js";
import { AtomicWriter } from "../writers/atomic-writer.js";

/**
 * Helper: creates a temp directory for each test.
 */
function createTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "atomic-writer-test-"));
}

/**
 * Helper: creates a ValidatedPath (branded type) for testing.
 * In production, this would come from PathValidator.safeResolvePath.
 */
function asValidatedPath(p: string): ValidatedPath {
	return p as ValidatedPath;
}

describe("AtomicWriter", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = createTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("writeFile — basic operations", () => {
		it("writes content to a new file", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "test.txt"));
			const result = AtomicWriter.writeFile(filePath, "hello world");

			expect(result.path).toBe(filePath);
			expect(result.bytesWritten).toBe(Buffer.byteLength("hello world"));
			expect(result.warnings).toEqual([]);

			const content = fs.readFileSync(filePath, "utf8");
			expect(content).toBe("hello world");
		});

		it("overwrites existing file content", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "test.txt"));
			fs.writeFileSync(filePath, "old content");

			AtomicWriter.writeFile(filePath, "new content");

			const content = fs.readFileSync(filePath, "utf8");
			expect(content).toBe("new content");
		});

		it("sets correct file permissions (0o644)", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "test.txt"));
			AtomicWriter.writeFile(filePath, "content");

			const stats = fs.statSync(filePath);
			// On Unix, mode includes file type bits — mask with 0o777 for permission bits
			const permissions = stats.mode & 0o777;
			expect(permissions).toBe(0o644);
		});

		it("returns correct byte count for UTF-8 content", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "unicode.txt"));
			const content = "Hello \u{1F600} World"; // emoji is 4 bytes in UTF-8
			const result = AtomicWriter.writeFile(filePath, content);

			expect(result.bytesWritten).toBe(Buffer.byteLength(content, "utf8"));
		});

		it("writes empty content", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "empty.txt"));
			const result = AtomicWriter.writeFile(filePath, "");

			expect(result.bytesWritten).toBe(0);
			expect(fs.readFileSync(filePath, "utf8")).toBe("");
		});
	});

	describe("writeFile — custom options", () => {
		it("respects custom file mode", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "restricted.txt"));
			AtomicWriter.writeFile(filePath, "secret", { mode: 0o600 });

			const stats = fs.statSync(filePath);
			const permissions = stats.mode & 0o777;
			expect(permissions).toBe(0o600);
		});
	});

	describe("writeFile — WriteGuard integration", () => {
		it("returns warnings when secrets are detected (warn mode)", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "config.txt"));
			const content = "aws_key = AKIAIOSFODNN7EXAMPLE";
			const result = AtomicWriter.writeFile(filePath, content);

			expect(result.warnings.length).toBeGreaterThan(0);
			// File should still be written in warn mode
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});

		it("blocks write in strict mode when secrets detected", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "blocked.txt"));
			const content = "AKIAIOSFODNN7EXAMPLE";

			expect(() =>
				AtomicWriter.writeFile(filePath, content, {
					guard: { strict: true },
				}),
			).toThrow(SecurityError);

			// File should NOT exist
			expect(fs.existsSync(filePath)).toBe(false);
		});

		it("allows bypass comment in strict mode", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "bypass.txt"));
			const content = "<!-- dev-sesssion:allow -->\nAKIAIOSFODNN7EXAMPLE";
			const result = AtomicWriter.writeFile(filePath, content, {
				guard: { strict: true },
			});

			expect(result.warnings).toEqual([]);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});

		it("skips guard when skipGuard is true", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "skipped.txt"));
			const content = "AKIAIOSFODNN7EXAMPLE";
			const result = AtomicWriter.writeFile(filePath, content, {
				skipGuard: true,
			});

			expect(result.warnings).toEqual([]);
			expect(fs.readFileSync(filePath, "utf8")).toBe(content);
		});
	});

	describe("writeFileAsync — basic operations", () => {
		it("writes content asynchronously", async () => {
			const filePath = asValidatedPath(path.join(tmpDir, "async.txt"));
			const result = await AtomicWriter.writeFileAsync(filePath, "async content");

			expect(result.path).toBe(filePath);
			expect(result.bytesWritten).toBe(Buffer.byteLength("async content"));
			expect(fs.readFileSync(filePath, "utf8")).toBe("async content");
		});

		it("blocks in strict mode when secrets detected", async () => {
			const filePath = asValidatedPath(path.join(tmpDir, "blocked.txt"));
			const content = "AKIAIOSFODNN7EXAMPLE";

			await expect(
				AtomicWriter.writeFileAsync(filePath, content, {
					guard: { strict: true },
				}),
			).rejects.toThrow(SecurityError);
		});
	});

	describe("writeFile — error handling", () => {
		it("throws when writing to non-existent directory", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "nonexistent", "dir", "file.txt"));
			expect(() => AtomicWriter.writeFile(filePath, "content")).toThrow();
		});

		it("does not leave tmp files after error", () => {
			const filePath = asValidatedPath(path.join(tmpDir, "nonexistent", "file.txt"));
			try {
				AtomicWriter.writeFile(filePath, "content");
			} catch {
				// Expected to fail
			}

			// Verify no orphaned tmp files in the parent directory
			const files = fs.readdirSync(tmpDir);
			expect(files.every((f) => !f.includes(".tmp"))).toBe(true);
		});
	});
});
