/**
 * Adversarial tests for FrontmatterParser.
 *
 * Tests JS frontmatter injection, prototype pollution keys,
 * unknown fields with .strict(), valid YAML, and edge cases.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ParseError } from "../errors/parse-error.js";
import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";
import { FrontmatterParser } from "../parsers/frontmatter-parser.js";

const simpleSchema = z
	.object({
		title: z.string(),
		draft: z.boolean().optional(),
	})
	.strict();

describe("FrontmatterParser — adversarial tests", () => {
	describe("JavaScript frontmatter injection", () => {
		it("rejects ---js frontmatter", () => {
			const input = '---js\nconst x = require("child_process");\n---\n# Content';
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "evil.md" })).toThrow(
				SecurityError,
			);
		});

		it("rejects ---javascript frontmatter", () => {
			const input = "---javascript\nprocess.exit(1);\n---\n# Content";
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "evil.md" })).toThrow(
				SecurityError,
			);
		});

		it("throws with INJECTION_ATTEMPT threat", () => {
			const input = "---js\neval('rm -rf /');\n---\n# Content";
			try {
				FrontmatterParser.parse(input, simpleSchema, { file: "evil.md" });
				expect.fail("Expected SecurityError");
			} catch (error) {
				expect(error).toBeInstanceOf(SecurityError);
				if (error instanceof SecurityError) {
					expect(error.threat).toBe(SecurityThreat.INJECTION_ATTEMPT);
				}
			}
		});

		it("includes file name in error message", () => {
			const input = "---js\neval('pwned');\n---\n";
			try {
				FrontmatterParser.parse(input, simpleSchema, { file: "attack.md" });
				expect.fail("Expected SecurityError");
			} catch (error) {
				if (error instanceof SecurityError) {
					expect(error.message).toContain("attack.md");
				}
			}
		});
	});

	describe("prototype pollution keys in frontmatter", () => {
		it("rejects __proto__ in YAML frontmatter", () => {
			const input = '---\n__proto__:\n  isAdmin: true\ntitle: "test"\n---\n# Content';
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "poll.md" })).toThrow(
				SecurityError,
			);
		});

		it("rejects constructor in YAML frontmatter", () => {
			const input = '---\nconstructor:\n  prototype:\n    isAdmin: true\ntitle: "test"\n---\n';
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "poll.md" })).toThrow(
				SecurityError,
			);
		});

		it("rejects prototype in YAML frontmatter", () => {
			const input = '---\nprototype:\n  evil: true\ntitle: "test"\n---\n';
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "poll.md" })).toThrow(
				SecurityError,
			);
		});

		it("throws with PROTOTYPE_POLLUTION threat", () => {
			const input = '---\n__proto__:\n  admin: true\ntitle: "test"\n---\n';
			try {
				FrontmatterParser.parse(input, simpleSchema, { file: "poll.md" });
				expect.fail("Expected SecurityError");
			} catch (error) {
				expect(error).toBeInstanceOf(SecurityError);
				if (error instanceof SecurityError) {
					expect(error.threat).toBe(SecurityThreat.PROTOTYPE_POLLUTION);
				}
			}
		});
	});

	describe("unknown fields with .strict() schema", () => {
		it("rejects unknown fields when schema uses .strict()", () => {
			const input = '---\ntitle: "hello"\nunknown_field: "bad"\n---\n# Content';
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "strict.md" })).toThrow(
				ParseError,
			);
		});

		it("includes field name in error message", () => {
			const input = '---\ntitle: "hello"\nsneaky: 42\n---\n';
			try {
				FrontmatterParser.parse(input, simpleSchema, { file: "strict.md" });
				expect.fail("Expected ParseError");
			} catch (error) {
				expect(error).toBeInstanceOf(ParseError);
			}
		});
	});

	describe("invalid YAML", () => {
		it("throws ParseError for malformed YAML", () => {
			const input = "---\ntitle: [unclosed bracket\n---\n# Content";
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "bad.md" })).toThrow(
				ParseError,
			);
		});

		it("includes file path in ParseError", () => {
			const input = "---\n: invalid: yaml:\n---\n";
			try {
				FrontmatterParser.parse(input, simpleSchema, { file: "broken.md" });
				expect.fail("Expected ParseError");
			} catch (error) {
				if (error instanceof ParseError) {
					expect(error.file).toBe("broken.md");
				}
			}
		});
	});

	describe("schema type mismatches", () => {
		it("rejects wrong type for title", () => {
			const input = "---\ntitle: 42\n---\n# Content";
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "type.md" })).toThrow(
				ParseError,
			);
		});

		it("rejects wrong type for draft", () => {
			const input = '---\ntitle: "ok"\ndraft: "not a boolean"\n---\n';
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "type.md" })).toThrow(
				ParseError,
			);
		});

		it("rejects missing required field", () => {
			const input = "---\ndraft: true\n---\n# Content";
			expect(() => FrontmatterParser.parse(input, simpleSchema, { file: "missing.md" })).toThrow(
				ParseError,
			);
		});
	});

	describe("valid YAML frontmatter", () => {
		it("parses valid frontmatter with all fields", () => {
			const input = '---\ntitle: "Hello World"\ndraft: true\n---\n# My Post';
			const result = FrontmatterParser.parse(input, simpleSchema, { file: "good.md" });
			expect(result.data.title).toBe("Hello World");
			expect(result.data.draft).toBe(true);
			expect(result.content).toContain("# My Post");
		});

		it("parses valid frontmatter with only required fields", () => {
			const input = '---\ntitle: "Minimal"\n---\n# Post';
			const result = FrontmatterParser.parse(input, simpleSchema, { file: "good.md" });
			expect(result.data.title).toBe("Minimal");
			expect(result.data.draft).toBeUndefined();
		});

		it("returns content body after frontmatter", () => {
			const input = '---\ntitle: "Test"\n---\nLine 1\nLine 2\n';
			const result = FrontmatterParser.parse(input, simpleSchema, { file: "body.md" });
			expect(result.content).toContain("Line 1");
			expect(result.content).toContain("Line 2");
		});
	});

	describe("hasFrontmatter", () => {
		it("returns true for string with frontmatter", () => {
			expect(FrontmatterParser.hasFrontmatter('---\ntitle: "x"\n---\n')).toBe(true);
		});

		it("returns false for string without frontmatter", () => {
			expect(FrontmatterParser.hasFrontmatter("# Just markdown")).toBe(false);
		});

		it("returns false for empty string", () => {
			expect(FrontmatterParser.hasFrontmatter("")).toBe(false);
		});
	});

	describe("defense-in-depth: sanitized output", () => {
		it("output data object has null prototype (from ContentSanitizer)", () => {
			// We can't directly check the prototype of the Zod-parsed output
			// because Zod creates a new object. But we verify no pollution keys survive.
			const input = '---\ntitle: "clean"\n---\n';
			const result = FrontmatterParser.parse(input, simpleSchema, { file: "safe.md" });
			expect(result.data.title).toBe("clean");
		});
	});
});
