/**
 * Adversarial tests for PathValidator.
 *
 * Tests path traversal attacks, null bytes, symlink traversal,
 * absolute paths, prefix attacks, and valid paths.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";
import { PathValidator } from "../validators/path-validator.js";

describe("PathValidator — adversarial tests", () => {
	let projectRoot: string;

	beforeEach(() => {
		// Use fs.realpathSync to resolve /tmp -> /private/tmp on macOS
		projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pathval-test-")));
		// Create some nested structure
		fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
		fs.writeFileSync(path.join(projectRoot, "src", "index.ts"), "");
		fs.writeFileSync(path.join(projectRoot, "README.md"), "");
	});

	afterEach(() => {
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});

	describe("path traversal attacks", () => {
		it("rejects ../../../etc/passwd", () => {
			expect(() => PathValidator.safeResolvePath("../../../etc/passwd", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("rejects ../../.. (bare traversal)", () => {
			expect(() => PathValidator.safeResolvePath("../../..", projectRoot)).toThrow(SecurityError);
		});

		it("rejects deeply nested traversal", () => {
			const deep = `${"../".repeat(20)}etc/shadow`;
			expect(() => PathValidator.safeResolvePath(deep, projectRoot)).toThrow(SecurityError);
		});

		it("rejects traversal with intermediate valid segments", () => {
			expect(() => PathValidator.safeResolvePath("src/../../etc/passwd", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("rejects traversal that resolves to parent of root", () => {
			expect(() => PathValidator.safeResolvePath("..", projectRoot)).toThrow(SecurityError);
		});

		it("rejects path with dot-dot using backslash on any platform", () => {
			// Even if this is a Unix system, we still reject the traversal pattern
			const traversal = "..\\..\\etc\\passwd";
			// On Unix this would be treated as a single filename with backslashes
			// but path.resolve would handle it — we verify no escape
			try {
				const result = PathValidator.safeResolvePath(traversal, projectRoot);
				// If it didn't throw, verify it stays within bounds
				expect(result.startsWith(projectRoot)).toBe(true);
			} catch (error) {
				expect(error).toBeInstanceOf(SecurityError);
			}
		});
	});

	describe("null byte attacks", () => {
		it("rejects null byte in path", () => {
			expect(() => PathValidator.safeResolvePath("src/index.ts\0.jpg", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("rejects null byte at start", () => {
			expect(() => PathValidator.safeResolvePath("\0malicious", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("rejects null byte at end", () => {
			expect(() => PathValidator.safeResolvePath("file.txt\0", projectRoot)).toThrow(SecurityError);
		});

		it("rejects embedded null bytes in traversal", () => {
			expect(() => PathValidator.safeResolvePath("../\0../../etc/passwd", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("throws with PATH_TRAVERSAL threat for null bytes", () => {
			try {
				PathValidator.safeResolvePath("file\0.txt", projectRoot);
				expect.fail("Expected SecurityError");
			} catch (error) {
				expect(error).toBeInstanceOf(SecurityError);
				if (error instanceof SecurityError) {
					expect(error.threat).toBe(SecurityThreat.PATH_TRAVERSAL);
				}
			}
		});
	});

	describe("absolute path rejection", () => {
		it("rejects absolute Unix path", () => {
			expect(() => PathValidator.safeResolvePath("/etc/passwd", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("rejects absolute path to project root itself", () => {
			expect(() => PathValidator.safeResolvePath(projectRoot, projectRoot)).toThrow(SecurityError);
		});
	});

	describe("prototype pollution segments", () => {
		it("rejects __proto__ as path segment", () => {
			expect(() => PathValidator.safeResolvePath("__proto__/file.txt", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("rejects constructor as path segment", () => {
			expect(() => PathValidator.safeResolvePath("constructor/file.txt", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("rejects prototype as path segment", () => {
			expect(() => PathValidator.safeResolvePath("prototype/file.txt", projectRoot)).toThrow(
				SecurityError,
			);
		});

		it("rejects __proto__ in nested path", () => {
			expect(() => PathValidator.safeResolvePath("src/__proto__/hack.ts", projectRoot)).toThrow(
				SecurityError,
			);
		});
	});

	describe("prefix attacks", () => {
		it("rejects paths that share a prefix with root but are outside", () => {
			// Create a sibling directory with a similar name
			const evilRoot = `${projectRoot}-evil`;
			fs.mkdirSync(evilRoot, { recursive: true });
			fs.writeFileSync(path.join(evilRoot, "steal.txt"), "");

			try {
				// This should fail because we can't use absolute paths
				expect(() => PathValidator.safeResolvePath(`${evilRoot}/steal.txt`, projectRoot)).toThrow(
					SecurityError,
				);
			} finally {
				fs.rmSync(evilRoot, { recursive: true, force: true });
			}
		});
	});

	describe("symlink traversal (safeResolveRealPath)", () => {
		it("rejects symlink pointing outside project root", () => {
			const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "outside-")));
			fs.writeFileSync(path.join(outsideDir, "secret.txt"), "top-secret");

			// Create symlink inside project that points outside
			const symlinkPath = path.join(projectRoot, "evil-link");
			fs.symlinkSync(outsideDir, symlinkPath);

			try {
				expect(() =>
					PathValidator.safeResolveRealPath("evil-link/secret.txt", projectRoot),
				).toThrow(SecurityError);
			} finally {
				fs.rmSync(outsideDir, { recursive: true, force: true });
			}
		});

		it("allows symlink within project root", () => {
			// Create symlink that stays within root
			fs.symlinkSync(path.join(projectRoot, "src"), path.join(projectRoot, "src-link"));

			const result = PathValidator.safeResolveRealPath("src-link/index.ts", projectRoot);
			expect(result).toBeTruthy();
		});

		it("rejects non-existent paths", () => {
			expect(() => PathValidator.safeResolveRealPath("nonexistent/file.txt", projectRoot)).toThrow(
				SecurityError,
			);
		});
	});

	describe("valid paths", () => {
		it("accepts simple relative path", () => {
			const result = PathValidator.safeResolvePath("README.md", projectRoot);
			expect(result).toBe(path.join(projectRoot, "README.md"));
		});

		it("accepts nested relative path", () => {
			const result = PathValidator.safeResolvePath("src/index.ts", projectRoot);
			expect(result).toBe(path.join(projectRoot, "src", "index.ts"));
		});

		it("accepts path with dots in filename", () => {
			const result = PathValidator.safeResolvePath("file.test.ts", projectRoot);
			expect(result).toBe(path.join(projectRoot, "file.test.ts"));
		});

		it("accepts current directory reference", () => {
			const result = PathValidator.safeResolvePath("./src/index.ts", projectRoot);
			expect(result).toBe(path.join(projectRoot, "src", "index.ts"));
		});

		it("returns branded ValidatedPath type", () => {
			const result = PathValidator.safeResolvePath("README.md", projectRoot);
			// The branded type is a compile-time check — at runtime it's just a string
			expect(typeof result).toBe("string");
		});
	});
});
