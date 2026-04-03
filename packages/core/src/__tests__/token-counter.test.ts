import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TokenCounterInstance } from "../counters/token-counter.js";
import { TokenCounter } from "../counters/token-counter.js";
import type { ExternalTokenCounter } from "../schemas/token-counting.js";

/**
 * Helper: casts a string to ValidatedPath for testing.
 */
function asValidatedPath(p: string): ValidatedPath {
	return p as ValidatedPath;
}

describe("TokenCounter", () => {
	describe("heuristicCount", () => {
		it("estimates ~1 token per 4 bytes for ASCII", () => {
			// 100 ASCII chars = 100 bytes → 25 tokens
			const content = "a".repeat(100);
			expect(TokenCounter.heuristicCount(content)).toBe(25);
		});

		it("returns 0 for empty string", () => {
			expect(TokenCounter.heuristicCount("")).toBe(0);
		});

		it("rounds up for non-divisible lengths", () => {
			// 7 bytes → ceil(7/4) = 2
			expect(TokenCounter.heuristicCount("abcdefg")).toBe(2);
		});

		it("accounts for multi-byte characters", () => {
			// Each emoji is 4 bytes in UTF-8
			const emoji = "😀😀😀😀"; // 16 bytes → 4 tokens
			expect(TokenCounter.heuristicCount(emoji)).toBe(4);
		});

		it("handles single character", () => {
			expect(TokenCounter.heuristicCount("x")).toBe(1);
		});
	});

	describe("heuristicCountFromBytes", () => {
		it("estimates ~1 token per 4 bytes", () => {
			expect(TokenCounter.heuristicCountFromBytes(1000)).toBe(250);
		});

		it("returns 0 for 0 bytes", () => {
			expect(TokenCounter.heuristicCountFromBytes(0)).toBe(0);
		});

		it("rounds up", () => {
			expect(TokenCounter.heuristicCountFromBytes(7)).toBe(2);
			expect(TokenCounter.heuristicCountFromBytes(1)).toBe(1);
		});
	});

	describe("create (heuristic-only)", () => {
		let counter: TokenCounterInstance;

		beforeEach(() => {
			counter = TokenCounter.create();
		});

		it("hasExternalCounter is false", () => {
			expect(counter.hasExternalCounter).toBe(false);
		});

		describe("countString", () => {
			it("returns heuristic result with accurate: false", async () => {
				const result = await counter.countString("Hello, world!");
				expect(result.accurate).toBe(false);
				expect(result.tokens).toBeGreaterThan(0);
			});

			it("estimates correctly for known content", async () => {
				// 100 bytes → 25 tokens
				const result = await counter.countString("a".repeat(100));
				expect(result.tokens).toBe(25);
				expect(result.accurate).toBe(false);
			});

			it("handles empty string", async () => {
				const result = await counter.countString("");
				expect(result.tokens).toBe(0);
				expect(result.accurate).toBe(false);
			});
		});

		describe("countFile", () => {
			let tmpDir: string;

			beforeEach(() => {
				tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-counter-"));
			});

			afterEach(() => {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			});

			it("reads file and returns heuristic count", async () => {
				const filePath = path.join(tmpDir, "test.ts");
				fs.writeFileSync(filePath, "const x = 42;\n".repeat(10)); // 150 bytes
				const result = await counter.countFile(asValidatedPath(filePath));
				expect(result.accurate).toBe(false);
				expect(result.tokens).toBeGreaterThan(0);
			});

			it("handles empty file", async () => {
				const filePath = path.join(tmpDir, "empty.ts");
				fs.writeFileSync(filePath, "");
				const result = await counter.countFile(asValidatedPath(filePath));
				expect(result.tokens).toBe(0);
				expect(result.accurate).toBe(false);
			});

			it("throws CliError for non-existent file", async () => {
				const filePath = path.join(tmpDir, "nonexistent.ts");
				await expect(counter.countFile(asValidatedPath(filePath))).rejects.toThrow(
					"Failed to read file for token counting",
				);
			});
		});

		describe("countFiles", () => {
			let tmpDir: string;

			beforeEach(() => {
				tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-counter-batch-"));
			});

			afterEach(() => {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			});

			it("returns a TokenCostMap with all files", async () => {
				const file1 = path.join(tmpDir, "a.ts");
				const file2 = path.join(tmpDir, "b.ts");
				const file3 = path.join(tmpDir, "c.ts");
				fs.writeFileSync(file1, "a".repeat(100));
				fs.writeFileSync(file2, "b".repeat(200));
				fs.writeFileSync(file3, "c".repeat(400));

				const paths = [asValidatedPath(file1), asValidatedPath(file2), asValidatedPath(file3)];
				const result = await counter.countFiles(paths);

				expect(result.size).toBe(3);
				expect(result.get(file1)?.tokens).toBe(25); // 100/4
				expect(result.get(file2)?.tokens).toBe(50); // 200/4
				expect(result.get(file3)?.tokens).toBe(100); // 400/4

				// All should be inaccurate (heuristic)
				for (const entry of result.values()) {
					expect(entry.accurate).toBe(false);
				}
			});

			it("returns empty map for empty paths array", async () => {
				const result = await counter.countFiles([]);
				expect(result.size).toBe(0);
			});
		});
	});

	describe("create (with external counter)", () => {
		it("hasExternalCounter is true when callback provided", () => {
			const external: ExternalTokenCounter = async () => 42;
			const counter = TokenCounter.create({ externalCounter: external });
			expect(counter.hasExternalCounter).toBe(true);
		});

		it("uses external counter for countString", async () => {
			const external: ExternalTokenCounter = async (content) => content.length * 2;
			const counter = TokenCounter.create({ externalCounter: external });

			const result = await counter.countString("hello"); // 5 chars → 10
			expect(result.tokens).toBe(10);
			expect(result.accurate).toBe(true);
		});

		it("falls back to heuristic when external counter throws", async () => {
			const external: ExternalTokenCounter = async () => {
				throw new Error("API unavailable");
			};
			const counter = TokenCounter.create({ externalCounter: external });

			const result = await counter.countString("a".repeat(100));
			expect(result.tokens).toBe(25); // heuristic: 100/4
			expect(result.accurate).toBe(false);
		});

		it("falls back to heuristic when external counter rejects", async () => {
			const external: ExternalTokenCounter = async () => {
				return Promise.reject(new Error("Network error"));
			};
			const counter = TokenCounter.create({ externalCounter: external });

			const result = await counter.countString("abcdefgh");
			expect(result.tokens).toBe(2); // heuristic: 8/4
			expect(result.accurate).toBe(false);
		});

		describe("countFile with external counter", () => {
			let tmpDir: string;

			beforeEach(() => {
				tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-counter-ext-"));
			});

			afterEach(() => {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			});

			it("uses external counter for file content", async () => {
				const filePath = path.join(tmpDir, "test.ts");
				fs.writeFileSync(filePath, "const x = 1;\n");

				let receivedContent = "";
				const external: ExternalTokenCounter = async (content) => {
					receivedContent = content;
					return 99;
				};
				const counter = TokenCounter.create({ externalCounter: external });

				const result = await counter.countFile(asValidatedPath(filePath));
				expect(result.tokens).toBe(99);
				expect(result.accurate).toBe(true);
				expect(receivedContent).toBe("const x = 1;\n");
			});
		});

		describe("countFiles with external counter", () => {
			let tmpDir: string;

			beforeEach(() => {
				tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-counter-batch-ext-"));
			});

			afterEach(() => {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			});

			it("returns accurate results for all files", async () => {
				const file1 = path.join(tmpDir, "a.ts");
				const file2 = path.join(tmpDir, "b.ts");
				fs.writeFileSync(file1, "aaa");
				fs.writeFileSync(file2, "bbbbbb");

				const external: ExternalTokenCounter = async (content) => content.length;
				const counter = TokenCounter.create({ externalCounter: external });

				const result = await counter.countFiles([asValidatedPath(file1), asValidatedPath(file2)]);

				expect(result.size).toBe(2);
				expect(result.get(file1)).toEqual({ tokens: 3, accurate: true });
				expect(result.get(file2)).toEqual({ tokens: 6, accurate: true });
			});

			it("returns mixed accuracy when external fails for some files", async () => {
				const file1 = path.join(tmpDir, "good.ts");
				const file2 = path.join(tmpDir, "bad.ts");
				fs.writeFileSync(file1, "good");
				fs.writeFileSync(file2, "bad");

				let callCount = 0;
				const external: ExternalTokenCounter = async (content) => {
					callCount++;
					if (content === "bad") {
						throw new Error("API error");
					}
					return content.length;
				};
				const counter = TokenCounter.create({ externalCounter: external });

				const result = await counter.countFiles([asValidatedPath(file1), asValidatedPath(file2)]);

				expect(result.get(file1)).toEqual({ tokens: 4, accurate: true });
				// "bad" = 3 bytes → ceil(3/4) = 1 token (heuristic fallback)
				expect(result.get(file2)).toEqual({ tokens: 1, accurate: false });
				expect(callCount).toBe(2);
			});
		});
	});

	describe("offline graceful degradation", () => {
		it("never throws when no external counter — always returns heuristic", async () => {
			const counter = TokenCounter.create();

			// All methods should resolve without throwing
			const stringResult = await counter.countString("test content");
			expect(stringResult.accurate).toBe(false);
			expect(stringResult.tokens).toBeGreaterThan(0);
		});

		it("external counter failure does not propagate", async () => {
			const external: ExternalTokenCounter = async () => {
				throw new TypeError("Cannot read properties of undefined");
			};
			const counter = TokenCounter.create({ externalCounter: external });

			// Should NOT throw — should fall back to heuristic
			const result = await counter.countString("some content");
			expect(result.accurate).toBe(false);
			expect(result.tokens).toBeGreaterThan(0);
		});
	});
});
