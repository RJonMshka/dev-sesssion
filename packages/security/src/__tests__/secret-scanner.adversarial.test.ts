/**
 * Adversarial tests for SecretScanner.
 *
 * Verifies each of the 10 patterns triggers correctly,
 * partial matches don't trigger, and redacted output never
 * contains the full secret value.
 */
import { describe, expect, it } from "vitest";
import { SecretScanner } from "../scanners/secret-scanner.js";

describe("SecretScanner — adversarial tests", () => {
	describe("each pattern triggers independently", () => {
		it("pattern 1: AWS Access Key (AKIA prefix + 16 uppercase/digits)", () => {
			const results = SecretScanner.scan("AKIAIOSFODNN7EXAMPLE");
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("AWS Access Key");
		});

		it("pattern 2: AWS Secret Key (key=value assignment)", () => {
			const results = SecretScanner.scan(
				'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"',
			);
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("AWS Secret Key");
		});

		it("pattern 3: GitHub PAT classic (ghp_ + 36 chars)", () => {
			// Exactly 36 alphanumeric chars after ghp_
			const results = SecretScanner.scan("ghp_1234567890ABCDEFGHIJKLMNOPQRSTUVWXab");
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("GitHub PAT (classic)");
		});

		it("pattern 4: GitHub PAT fine-grained (github_pat_ + 22 + _ + 59)", () => {
			const pat22 = "A".repeat(22);
			const pat59 = "B".repeat(59);
			const token = `github_pat_${pat22}_${pat59}`;
			const results = SecretScanner.scan(token);
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("GitHub PAT (fine-grained)");
		});

		it("pattern 5: npm Token (npm_ + 36 chars)", () => {
			// Exactly 36 alphanumeric chars after npm_
			const results = SecretScanner.scan("npm_1234567890ABCDEFGHIJKLMNOPQRSTUVWXab");
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("npm Token");
		});

		it("pattern 6: OpenAI API Key (sk- + 20 + T3BlbkFJ + 20)", () => {
			const prefix = "A".repeat(20);
			const suffix = "B".repeat(20);
			const results = SecretScanner.scan(`sk-${prefix}T3BlbkFJ${suffix}`);
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("OpenAI API Key");
		});

		it("pattern 7: Anthropic API Key (sk-ant- + 80+ chars)", () => {
			const key = `sk-ant-${"a".repeat(80)}`;
			const results = SecretScanner.scan(key);
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("Anthropic API Key");
		});

		it("pattern 8: Private Key Header (-----BEGIN [type] PRIVATE KEY-----)", () => {
			const results = SecretScanner.scan("-----BEGIN RSA PRIVATE KEY-----");
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("Private Key Header");
		});

		it("pattern 9: Generic Secret Assignment (secret/token/password = 'long_value')", () => {
			const results = SecretScanner.scan('api_key = "SuperSecretValue12345678"');
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("Generic Secret Assignment");
		});

		it("pattern 10: Generic Bearer Token (Bearer + base64-like)", () => {
			const results = SecretScanner.scan(
				"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
			);
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("Generic Bearer Token");
		});
	});

	describe("partial matches do NOT trigger", () => {
		it("AKIA with less than 16 following chars does not match", () => {
			expect(SecretScanner.scan("AKIA12345")).toEqual([]);
		});

		it("ghp_ with less than 36 following chars does not match", () => {
			expect(SecretScanner.scan("ghp_tooshort")).toEqual([]);
		});

		it("npm_ with less than 36 following chars does not match", () => {
			expect(SecretScanner.scan("npm_tooshort")).toEqual([]);
		});

		it("sk-ant- with less than 80 following chars does not match", () => {
			expect(
				SecretScanner.scan(`sk-ant-${"a".repeat(30)}`).some(
					(r) => r.pattern === "Anthropic API Key",
				),
			).toBe(false);
		});

		it("sk- without T3BlbkFJ marker does not match OpenAI pattern", () => {
			expect(
				SecretScanner.scan(`sk-${"A".repeat(40)}`).some((r) => r.pattern === "OpenAI API Key"),
			).toBe(false);
		});

		it("BEGIN PUBLIC KEY does not trigger private key detection", () => {
			expect(SecretScanner.scan("-----BEGIN PUBLIC KEY-----")).toEqual([]);
		});

		it("secret = 'short' (under 16 chars) does not trigger generic pattern", () => {
			expect(
				SecretScanner.scan('secret = "abc"').some((r) => r.pattern === "Generic Secret Assignment"),
			).toBe(false);
		});

		it("word 'Bearer' alone does not trigger", () => {
			expect(SecretScanner.scan("Bearer")).toEqual([]);
		});

		it("normal text mentioning 'password' without assignment does not trigger", () => {
			expect(SecretScanner.scan("Please reset your password")).toEqual([]);
		});
	});

	describe("redacted output verification", () => {
		it("AWS Access Key is redacted — only first 4 chars visible", () => {
			const results = SecretScanner.scan("AKIAIOSFODNN7EXAMPLE");
			const redacted = results[0]?.redacted ?? "";
			expect(redacted.startsWith("AKIA")).toBe(true);
			expect(redacted).not.toContain("IOSFODNN");
			expect(redacted).not.toContain("EXAMPLE");
		});

		it("GitHub PAT is redacted — does not contain full token", () => {
			// Exactly 36 alphanumeric chars after ghp_
			const token = "ghp_1234567890ABCDEFGHIJKLMNOPQRSTUVWXab";
			const results = SecretScanner.scan(token);
			const redacted = results[0]?.redacted ?? "";
			expect(redacted).not.toContain("ABCDEFGHIJ");
			expect(redacted.length).toBeGreaterThanOrEqual(10);
		});

		it("private key header redacted shows only first 4 chars of match", () => {
			const results = SecretScanner.scan("-----BEGIN RSA PRIVATE KEY-----");
			const redacted = results[0]?.redacted ?? "";
			// Full match would be "-----BEGIN RSA PRIVATE KEY-----" or captured group
			expect(redacted.length).toBeGreaterThanOrEqual(10);
			// The asterisks should dominate
			const asteriskCount = (redacted.match(/\*/g) ?? []).length;
			expect(asteriskCount).toBeGreaterThan(4);
		});

		it("redacted output is at least 10 characters long", () => {
			// Test with various patterns
			const testCases = [
				"AKIAIOSFODNN7EXAMPLE",
				"-----BEGIN PRIVATE KEY-----",
				'secret = "longvalue1234567890"',
			];
			for (const content of testCases) {
				const results = SecretScanner.scan(content);
				for (const result of results) {
					expect(result.redacted.length).toBeGreaterThanOrEqual(10);
				}
			}
		});

		it("redacted output never equals the full matched value", () => {
			const testCases = [
				"AKIAIOSFODNN7EXAMPLE",
				"ghp_1234567890ABCDEFGHIJKLMNOPQRSTUVab",
				'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"',
			];
			for (const content of testCases) {
				const results = SecretScanner.scan(content);
				for (const result of results) {
					// The redacted value must contain asterisks
					expect(result.redacted).toContain("*");
				}
			}
		});
	});

	describe("multi-pattern detection on single line", () => {
		it("detects multiple patterns on the same line", () => {
			// A line with both an AWS key and a secret assignment
			const content = 'AKIAIOSFODNN7EXAMPLE secret = "SuperSecretValue12345678"';
			const results = SecretScanner.scan(content);
			expect(results.length).toBeGreaterThanOrEqual(2);
			const patterns = new Set(results.map((r) => r.pattern));
			expect(patterns.has("AWS Access Key")).toBe(true);
			expect(patterns.has("Generic Secret Assignment")).toBe(true);
		});
	});

	describe("line number accuracy", () => {
		it("reports correct 1-indexed line numbers", () => {
			const content = "clean line 1\nclean line 2\nAKIAIOSFODNN7EXAMPLE\nclean line 4";
			const results = SecretScanner.scan(content);
			expect(results[0]?.line).toBe(3);
		});

		it("handles Windows-style line endings in split", () => {
			// \n is the delimiter — \r\n still splits on \n
			const content = "line1\r\nAKIAIOSFODNN7EXAMPLE\r\nline3";
			const results = SecretScanner.scan(content);
			expect(results[0]?.line).toBe(2);
		});
	});

	describe("edge cases", () => {
		it("handles very long content without performance issues", () => {
			const longContent = `${"safe line\n".repeat(10000)}AKIAIOSFODNN7EXAMPLE\n`;
			const start = Date.now();
			const results = SecretScanner.scan(longContent);
			const elapsed = Date.now() - start;
			expect(results).toHaveLength(1);
			expect(results[0]?.line).toBe(10001);
			// Should complete in under 1 second
			expect(elapsed).toBeLessThan(1000);
		});

		it("handles content with no newlines", () => {
			const results = SecretScanner.scan("AKIAIOSFODNN7EXAMPLE");
			expect(results).toHaveLength(1);
			expect(results[0]?.line).toBe(1);
		});

		it("handles content that is only newlines", () => {
			expect(SecretScanner.scan("\n\n\n")).toEqual([]);
		});
	});
});
