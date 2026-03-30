/**
 * Adversarial tests for WriteGuard.
 *
 * Verifies warn mode writes despite detection, strict mode blocks,
 * bypass comment is respected, and edge cases.
 */
import { describe, expect, it } from "vitest";
import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";
import { WriteGuard } from "../guards/write-guard.js";

describe("WriteGuard — adversarial tests", () => {
	describe("warn mode writes despite detection", () => {
		it("allows write with AWS key in warn mode", () => {
			const result = WriteGuard.check("AKIAIOSFODNN7EXAMPLE");
			expect(result.allowed).toBe(true);
			expect(result.results.length).toBeGreaterThan(0);
		});

		it("allows write with private key header in warn mode", () => {
			const result = WriteGuard.check("-----BEGIN RSA PRIVATE KEY-----\nMIIE...");
			expect(result.allowed).toBe(true);
			expect(result.results.length).toBeGreaterThan(0);
		});

		it("allows write with multiple secrets in warn mode", () => {
			const content = [
				"AKIAIOSFODNN7EXAMPLE",
				"-----BEGIN RSA PRIVATE KEY-----",
				'secret = "MySuperSecretValue12345"',
			].join("\n");
			const result = WriteGuard.check(content);
			expect(result.allowed).toBe(true);
			expect(result.results.length).toBeGreaterThanOrEqual(3);
		});

		it("reports all detected secrets as warnings", () => {
			const content = "AKIAIOSFODNN7EXAMPLE\n-----BEGIN EC PRIVATE KEY-----";
			const result = WriteGuard.check(content);
			const patterns = result.results.map((r) => r.pattern);
			expect(patterns).toContain("AWS Access Key");
			expect(patterns).toContain("Private Key Header");
		});
	});

	describe("strict mode blocks on detection", () => {
		it("throws SecurityError for any detected secret", () => {
			expect(() => WriteGuard.check("AKIAIOSFODNN7EXAMPLE", { strict: true })).toThrow(
				SecurityError,
			);
		});

		it("throws with SECRET_DETECTED threat", () => {
			try {
				WriteGuard.check("-----BEGIN RSA PRIVATE KEY-----", { strict: true });
				expect.fail("Expected SecurityError");
			} catch (error) {
				expect(error).toBeInstanceOf(SecurityError);
				if (error instanceof SecurityError) {
					expect(error.threat).toBe(SecurityThreat.SECRET_DETECTED);
					expect(error.message).toContain("Write blocked");
				}
			}
		});

		it("error message includes secret count", () => {
			const content = "AKIAIOSFODNN7EXAMPLE\n-----BEGIN RSA PRIVATE KEY-----";
			try {
				WriteGuard.check(content, { strict: true });
				expect.fail("Expected SecurityError");
			} catch (error) {
				if (error instanceof SecurityError) {
					expect(error.message).toContain("2 secrets");
				}
			}
		});

		it("error message includes pattern names", () => {
			try {
				WriteGuard.check("AKIAIOSFODNN7EXAMPLE", { strict: true });
				expect.fail("Expected SecurityError");
			} catch (error) {
				if (error instanceof SecurityError) {
					expect(error.message).toContain("AWS Access Key");
				}
			}
		});

		it("does not throw for clean content in strict mode", () => {
			const result = WriteGuard.check("# Just a normal markdown file\n\nNothing to see here.", {
				strict: true,
			});
			expect(result.allowed).toBe(true);
			expect(result.results).toEqual([]);
		});
	});

	describe("bypass comment is respected", () => {
		it("skips scanning when bypass comment is present", () => {
			const content = "<!-- dev-session:allow -->\nAKIAIOSFODNN7EXAMPLE";
			const result = WriteGuard.check(content);
			expect(result.allowed).toBe(true);
			expect(result.bypassed).toBe(true);
			expect(result.results).toEqual([]);
		});

		it("bypass works in strict mode too", () => {
			const content = "<!-- dev-session:allow -->\n-----BEGIN RSA PRIVATE KEY-----";
			expect(() => WriteGuard.check(content, { strict: true })).not.toThrow();
			const result = WriteGuard.check(content, { strict: true });
			expect(result.bypassed).toBe(true);
		});

		it("bypass comment can be anywhere in content", () => {
			const content = "AKIAIOSFODNN7EXAMPLE\n<!-- dev-session:allow -->\nMore content";
			const result = WriteGuard.check(content);
			expect(result.bypassed).toBe(true);
			expect(result.results).toEqual([]);
		});

		it("does not bypass with similar but incorrect comment", () => {
			const cases = [
				"<!-- dev-session:allowed -->",
				"<!-- dev-session allow -->",
				"<!-- dev-session:ALLOW -->",
				"<!-- devsession:allow -->",
				"<!-- dev-session:allow",
				"dev-session:allow -->",
			];
			for (const bypass of cases) {
				const content = `${bypass}\nAKIAIOSFODNN7EXAMPLE`;
				const result = WriteGuard.check(content);
				expect(result.bypassed).toBe(false);
				expect(result.results.length).toBeGreaterThan(0);
			}
		});

		it("exact bypass comment string is accessible via bypassComment getter", () => {
			expect(WriteGuard.bypassComment).toBe("<!-- dev-session:allow -->");
		});
	});

	describe("edge cases", () => {
		it("handles empty string", () => {
			const result = WriteGuard.check("");
			expect(result.allowed).toBe(true);
			expect(result.bypassed).toBe(false);
			expect(result.results).toEqual([]);
		});

		it("handles content with only whitespace", () => {
			const result = WriteGuard.check("   \n\t\n   ");
			expect(result.allowed).toBe(true);
			expect(result.results).toEqual([]);
		});

		it("handles very long clean content", () => {
			const content = "safe content\n".repeat(10000);
			const result = WriteGuard.check(content);
			expect(result.allowed).toBe(true);
			expect(result.results).toEqual([]);
		});
	});
});
