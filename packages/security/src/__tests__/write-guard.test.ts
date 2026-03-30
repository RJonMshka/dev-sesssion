import { describe, expect, it } from "vitest";
import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";
import { WriteGuard } from "../guards/write-guard.js";

describe("WriteGuard", () => {
	describe("bypassComment", () => {
		it("exposes the bypass comment string", () => {
			expect(WriteGuard.bypassComment).toBe("<!-- dev-session:allow -->");
		});
	});

	describe("check — clean content", () => {
		it("allows clean content", () => {
			const result = WriteGuard.check("Hello, world!");
			expect(result.allowed).toBe(true);
			expect(result.bypassed).toBe(false);
			expect(result.results).toEqual([]);
		});

		it("allows empty string", () => {
			const result = WriteGuard.check("");
			expect(result.allowed).toBe(true);
			expect(result.bypassed).toBe(false);
			expect(result.results).toEqual([]);
		});
	});

	describe("check — warn mode (default)", () => {
		it("allows content with secrets but reports warnings", () => {
			const content = "aws_key = AKIAIOSFODNN7EXAMPLE";
			const result = WriteGuard.check(content);
			expect(result.allowed).toBe(true);
			expect(result.bypassed).toBe(false);
			expect(result.results.length).toBeGreaterThan(0);
		});

		it("returns scan results with pattern and line info", () => {
			const content = "AKIAIOSFODNN7EXAMPLE";
			const result = WriteGuard.check(content);
			expect(result.results[0]?.pattern).toBe("AWS Access Key");
			expect(result.results[0]?.line).toBe(1);
			expect(result.results[0]?.redacted).toBeTruthy();
		});
	});

	describe("check — strict mode", () => {
		it("throws SecurityError when secrets are detected", () => {
			const content = "AKIAIOSFODNN7EXAMPLE";
			expect(() => WriteGuard.check(content, { strict: true })).toThrow(SecurityError);
		});

		it("throws with SECRET_DETECTED threat", () => {
			const content = "AKIAIOSFODNN7EXAMPLE";
			try {
				WriteGuard.check(content, { strict: true });
				expect.fail("Expected SecurityError to be thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(SecurityError);
				if (error instanceof SecurityError) {
					expect(error.threat).toBe(SecurityThreat.SECRET_DETECTED);
				}
			}
		});

		it("includes count and pattern names in error message", () => {
			const content = "AKIAIOSFODNN7EXAMPLE";
			try {
				WriteGuard.check(content, { strict: true });
				expect.fail("Expected SecurityError to be thrown");
			} catch (error) {
				if (error instanceof SecurityError) {
					expect(error.message).toContain("1 secret");
					expect(error.message).toContain("AWS Access Key");
				}
			}
		});

		it("allows clean content in strict mode", () => {
			const result = WriteGuard.check("Hello, world!", { strict: true });
			expect(result.allowed).toBe(true);
			expect(result.results).toEqual([]);
		});
	});

	describe("check — bypass comment", () => {
		it("bypasses scanning when content contains bypass comment", () => {
			const content = "<!-- dev-session:allow -->\nAKIAIOSFODNN7EXAMPLE";
			const result = WriteGuard.check(content);
			expect(result.allowed).toBe(true);
			expect(result.bypassed).toBe(true);
			expect(result.results).toEqual([]);
		});

		it("bypasses even in strict mode", () => {
			const content = "<!-- dev-session:allow -->\nAKIAIOSFODNN7EXAMPLE";
			const result = WriteGuard.check(content, { strict: true });
			expect(result.allowed).toBe(true);
			expect(result.bypassed).toBe(true);
			expect(result.results).toEqual([]);
		});

		it("does not bypass with a partial comment", () => {
			const content = "<!-- dev-session -->\nAKIAIOSFODNN7EXAMPLE";
			const result = WriteGuard.check(content);
			expect(result.bypassed).toBe(false);
			expect(result.results.length).toBeGreaterThan(0);
		});
	});

	describe("check — multiple secrets", () => {
		it("reports all detected secrets", () => {
			const content = ["AKIAIOSFODNN7EXAMPLE", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"].join(
				"\n",
			);
			const result = WriteGuard.check(content);
			expect(result.results.length).toBe(2);
			const patterns = result.results.map((r) => r.pattern);
			expect(patterns).toContain("AWS Access Key");
			expect(patterns).toContain("GitHub PAT (classic)");
		});

		it("strict mode error reports all patterns", () => {
			const content = ["AKIAIOSFODNN7EXAMPLE", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"].join(
				"\n",
			);
			try {
				WriteGuard.check(content, { strict: true });
				expect.fail("Expected SecurityError to be thrown");
			} catch (error) {
				if (error instanceof SecurityError) {
					expect(error.message).toContain("2 secrets");
				}
			}
		});
	});
});
