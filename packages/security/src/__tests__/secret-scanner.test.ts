import { describe, expect, it } from "vitest";
import { SecretScanner } from "../scanners/secret-scanner.js";

describe("SecretScanner", () => {
	describe("patternCount", () => {
		it("has exactly 10 patterns", () => {
			expect(SecretScanner.patternCount).toBe(10);
		});
	});

	describe("scan — empty and clean content", () => {
		it("returns empty array for empty string", () => {
			expect(SecretScanner.scan("")).toEqual([]);
		});

		it("returns empty array for normal content", () => {
			const content = "# Hello World\n\nThis is a normal markdown file.\n";
			expect(SecretScanner.scan(content)).toEqual([]);
		});

		it("returns empty array for short strings that look suspicious", () => {
			const content = "key = abc";
			expect(SecretScanner.scan(content)).toEqual([]);
		});
	});

	describe("scan — AWS Access Key", () => {
		it("detects an AWS access key", () => {
			const content = "aws_access_key_id = AKIAIOSFODNN7EXAMPLE";
			const results = SecretScanner.scan(content);
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("AWS Access Key");
			expect(results[0]?.line).toBe(1);
		});

		it("redacts the key showing only first 4 chars", () => {
			const content = "AKIAIOSFODNN7EXAMPLE";
			const results = SecretScanner.scan(content);
			expect(results[0]?.redacted).toMatch(/^AKIA\*+$/);
			expect(results[0]?.redacted).not.toContain("IOSFODNN");
		});

		it("does not match partial AWS keys", () => {
			const content = "AKIA123"; // Too short — need 16 chars after AKIA
			expect(SecretScanner.scan(content)).toEqual([]);
		});
	});

	describe("scan — AWS Secret Key", () => {
		it("detects aws_secret_access_key assignment", () => {
			const content = 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
			const results = SecretScanner.scan(content);
			expect(results).toHaveLength(1);
			expect(results[0]?.pattern).toBe("AWS Secret Key");
			expect(results[0]?.line).toBe(1);
		});

		it("detects AWS_SECRET_ACCESS_KEY env var", () => {
			const content = "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "AWS Secret Key")).toBe(true);
		});
	});

	describe("scan — GitHub PAT (classic)", () => {
		it("detects a GitHub classic PAT", () => {
			// ghp_ + exactly 36 alphanumeric chars
			const content = "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "GitHub PAT (classic)")).toBe(true);
		});

		it("does not match ghp_ with too few chars", () => {
			const content = "ghp_ABC";
			expect(SecretScanner.scan(content).some((r) => r.pattern === "GitHub PAT (classic)")).toBe(
				false,
			);
		});
	});

	describe("scan — GitHub PAT (fine-grained)", () => {
		it("detects a GitHub fine-grained PAT", () => {
			const token =
				"github_pat_1234567890ABCDEFabcdef_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567";
			const content = `GITHUB_TOKEN=${token}`;
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "GitHub PAT (fine-grained)")).toBe(true);
		});
	});

	describe("scan — npm Token", () => {
		it("detects an npm token", () => {
			// npm_ + exactly 36 alphanumeric chars
			const content = "//registry.npmjs.org/:_authToken=npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "npm Token")).toBe(true);
		});
	});

	describe("scan — OpenAI API Key", () => {
		it("detects an OpenAI API key", () => {
			const content = "OPENAI_API_KEY=sk-ABCDEFGHIJKLMNOPQRstT3BlbkFJABCDEFGHIJKLMNOPQRst";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "OpenAI API Key")).toBe(true);
		});
	});

	describe("scan — Anthropic API Key", () => {
		it("detects an Anthropic API key", () => {
			const key = `sk-ant-${"a".repeat(80)}`;
			const content = `ANTHROPIC_API_KEY=${key}`;
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Anthropic API Key")).toBe(true);
		});
	});

	describe("scan — Private Key Header", () => {
		it("detects RSA private key header", () => {
			const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Private Key Header")).toBe(true);
		});

		it("detects EC private key header", () => {
			const content = "-----BEGIN EC PRIVATE KEY-----";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Private Key Header")).toBe(true);
		});

		it("detects generic private key header", () => {
			const content = "-----BEGIN PRIVATE KEY-----";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Private Key Header")).toBe(true);
		});

		it("detects OPENSSH private key header", () => {
			const content = "-----BEGIN OPENSSH PRIVATE KEY-----";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Private Key Header")).toBe(true);
		});
	});

	describe("scan — Generic Secret Assignment", () => {
		it("detects secret = 'value' pattern", () => {
			const content = 'secret = "abcdefghij1234567890"';
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Generic Secret Assignment")).toBe(true);
		});

		it("detects api_key: 'value' pattern", () => {
			const content = "api_key: 'abcdefghij1234567890'";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Generic Secret Assignment")).toBe(true);
		});

		it("detects password assignment (case-insensitive)", () => {
			const content = 'PASSWORD = "MySecurePassword123"';
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Generic Secret Assignment")).toBe(true);
		});

		it("does not match short values", () => {
			const content = 'secret = "short"';
			expect(
				SecretScanner.scan(content).some((r) => r.pattern === "Generic Secret Assignment"),
			).toBe(false);
		});
	});

	describe("scan — Generic Bearer Token", () => {
		it("detects a Bearer token", () => {
			const content = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
			const results = SecretScanner.scan(content);
			expect(results.some((r) => r.pattern === "Generic Bearer Token")).toBe(true);
		});
	});

	describe("scan — multi-line content", () => {
		it("reports correct line numbers for each match", () => {
			const content = [
				"# Config",
				"",
				"AKIAIOSFODNN7EXAMPLE",
				"",
				"-----BEGIN RSA PRIVATE KEY-----",
			].join("\n");
			const results = SecretScanner.scan(content);
			expect(results).toHaveLength(2);
			expect(results[0]?.line).toBe(3);
			expect(results[1]?.line).toBe(5);
		});

		it("detects multiple patterns on separate lines", () => {
			const content = [
				"ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
				"npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
			].join("\n");
			const results = SecretScanner.scan(content);
			const patterns = results.map((r) => r.pattern);
			expect(patterns).toContain("GitHub PAT (classic)");
			expect(patterns).toContain("npm Token");
		});
	});

	describe("scan — redaction", () => {
		it("never contains more than 4 visible characters", () => {
			const content = "AKIAIOSFODNN7EXAMPLE";
			const results = SecretScanner.scan(content);
			const redacted = results[0]?.redacted ?? "";
			const visiblePart = redacted.replace(/\*+$/, "");
			expect(visiblePart.length).toBeLessThanOrEqual(4);
		});

		it("pads short matches to minimum length", () => {
			// Even if matched value is short, redacted output should be at least 10 chars
			const content = "-----BEGIN RSA PRIVATE KEY-----";
			const results = SecretScanner.scan(content);
			const redacted = results[0]?.redacted ?? "";
			expect(redacted.length).toBeGreaterThanOrEqual(10);
		});
	});
});
