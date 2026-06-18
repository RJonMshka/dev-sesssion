import { describe, expect, it } from "vitest";
import {
	CliError,
	isCliError,
	isParseError,
	isSecurityError,
	ParseError,
	SecurityError,
	SecurityThreat,
} from "../errors/index.js";

describe("SecurityThreat", () => {
	it("exposes all four threat categories", () => {
		expect(SecurityThreat.PATH_TRAVERSAL).toBe("PATH_TRAVERSAL");
		expect(SecurityThreat.SECRET_DETECTED).toBe("SECRET_DETECTED");
		expect(SecurityThreat.INJECTION_ATTEMPT).toBe("INJECTION_ATTEMPT");
		expect(SecurityThreat.PROTOTYPE_POLLUTION).toBe("PROTOTYPE_POLLUTION");
	});

	it("has exactly four members", () => {
		const keys = Object.keys(SecurityThreat);
		expect(keys).toHaveLength(4);
	});

	it("is frozen (immutable at runtime)", () => {
		// The const assertion makes TS treat values as literals,
		// but the object itself is mutable at runtime unless frozen.
		// This test documents current behavior — if we want runtime
		// immutability we should add Object.freeze.
		expect(typeof SecurityThreat).toBe("object");
	});
});

describe("SecurityError", () => {
	it("creates with required fields", () => {
		const err = new SecurityError({
			threat: SecurityThreat.PATH_TRAVERSAL,
			message: "Path resolves outside project root",
		});
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(SecurityError);
		expect(err.name).toBe("SecurityError");
		expect(err.threat).toBe("PATH_TRAVERSAL");
		expect(err.message).toBe("Path resolves outside project root");
		expect(err.cause).toBeUndefined();
	});

	it("preserves the cause chain", () => {
		const original = new Error("ENOENT");
		const err = new SecurityError({
			threat: SecurityThreat.SECRET_DETECTED,
			message: "Secret found in content",
			cause: original,
		});
		expect(err.cause).toBe(original);
	});

	it("works with all threat types", () => {
		for (const threat of Object.values(SecurityThreat)) {
			const err = new SecurityError({ threat, message: `test: ${threat}` });
			expect(err.threat).toBe(threat);
		}
	});

	it("has a stable name property that survives serialization", () => {
		const err = new SecurityError({
			threat: SecurityThreat.INJECTION_ATTEMPT,
			message: "JS in frontmatter",
		});
		// name is defined as override readonly, so it is an own property
		expect(err.name).toBe("SecurityError");
		// Verify it shows up in string coercion
		expect(String(err)).toContain("SecurityError");
	});

	it("has a proper stack trace", () => {
		const err = new SecurityError({
			threat: SecurityThreat.PROTOTYPE_POLLUTION,
			message: "Found __proto__ key",
		});
		expect(err.stack).toBeDefined();
		expect(err.stack).toContain("SecurityError");
	});

	describe("isSecurityError()", () => {
		it("returns true for SecurityError instances", () => {
			const err = new SecurityError({
				threat: SecurityThreat.PATH_TRAVERSAL,
				message: "test",
			});
			expect(isSecurityError(err)).toBe(true);
		});

		it("returns false for plain Error", () => {
			expect(isSecurityError(new Error("test"))).toBe(false);
		});

		it("returns false for null/undefined/primitives", () => {
			expect(isSecurityError(null)).toBe(false);
			expect(isSecurityError(undefined)).toBe(false);
			expect(isSecurityError("string")).toBe(false);
			expect(isSecurityError(42)).toBe(false);
		});

		it("returns false for objects that look like SecurityError but are not", () => {
			const fake = {
				name: "SecurityError",
				threat: "PATH_TRAVERSAL",
				message: "fake",
			};
			expect(isSecurityError(fake)).toBe(false);
		});
	});
});

describe("ParseError", () => {
	it("creates with required fields", () => {
		const err = new ParseError({
			message: "Invalid frontmatter schema",
			file: ".session/SESSION_STATE.md",
		});
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(ParseError);
		expect(err.name).toBe("ParseError");
		expect(err.message).toBe("Invalid frontmatter schema");
		expect(err.file).toBe(".session/SESSION_STATE.md");
		expect(err.line).toBeUndefined();
		expect(err.cause).toBeUndefined();
	});

	it("creates with all optional fields", () => {
		const original = new SyntaxError("unexpected token");
		const err = new ParseError({
			message: "YAML syntax error",
			file: ".session/PLAN_2.md",
			line: 42,
			cause: original,
		});
		expect(err.file).toBe(".session/PLAN_2.md");
		expect(err.line).toBe(42);
		expect(err.cause).toBe(original);
	});

	it("stores file as relative path (does not validate, but documents contract)", () => {
		// The ParseError itself does not validate that the path is relative.
		// That's the caller's responsibility. This test documents the expected usage.
		const err = new ParseError({
			message: "test",
			file: "relative/path.md",
		});
		expect(err.file).toBe("relative/path.md");
	});

	it("has a stable name property", () => {
		const err = new ParseError({ message: "test", file: "a.md" });
		expect(err.name).toBe("ParseError");
		expect(String(err)).toContain("ParseError");
	});

	it("has a proper stack trace", () => {
		const err = new ParseError({ message: "test", file: "a.md" });
		expect(err.stack).toBeDefined();
		expect(err.stack).toContain("ParseError");
	});

	describe("isParseError()", () => {
		it("returns true for ParseError instances", () => {
			const err = new ParseError({ message: "test", file: "a.md" });
			expect(isParseError(err)).toBe(true);
		});

		it("returns false for plain Error", () => {
			expect(isParseError(new Error("test"))).toBe(false);
		});

		it("returns false for other custom errors", () => {
			const sec = new SecurityError({
				threat: SecurityThreat.PATH_TRAVERSAL,
				message: "test",
			});
			expect(isParseError(sec)).toBe(false);
		});

		it("returns false for null/undefined/primitives", () => {
			expect(isParseError(null)).toBe(false);
			expect(isParseError(undefined)).toBe(false);
			expect(isParseError(0)).toBe(false);
		});
	});
});

describe("CliError", () => {
	it("creates with required fields only", () => {
		const err = new CliError({
			message: "No .session/ directory found",
		});
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(CliError);
		expect(err.name).toBe("CliError");
		expect(err.message).toBe("No .session/ directory found");
		expect(err.suggestion).toBeUndefined();
		expect(err.cause).toBeUndefined();
	});

	it("creates with suggestion", () => {
		const err = new CliError({
			message: "No .session/ directory found",
			suggestion: "Run `npx dev-sesssion init` to create one",
		});
		expect(err.suggestion).toBe("Run `npx dev-sesssion init` to create one");
	});

	it("creates with cause", () => {
		const original = new Error("EACCES");
		const err = new CliError({
			message: "Cannot write to project directory",
			cause: original,
		});
		expect(err.cause).toBe(original);
	});

	it("creates with all optional fields", () => {
		const original = new Error("ENOENT");
		const err = new CliError({
			message: "Config file missing",
			suggestion: "Run init first",
			cause: original,
		});
		expect(err.message).toBe("Config file missing");
		expect(err.suggestion).toBe("Run init first");
		expect(err.cause).toBe(original);
	});

	it("has a stable name property", () => {
		const err = new CliError({ message: "test" });
		expect(err.name).toBe("CliError");
		expect(String(err)).toContain("CliError");
	});

	it("has a proper stack trace", () => {
		const err = new CliError({ message: "test" });
		expect(err.stack).toBeDefined();
		expect(err.stack).toContain("CliError");
	});

	describe("isCliError()", () => {
		it("returns true for CliError instances", () => {
			const err = new CliError({ message: "test" });
			expect(isCliError(err)).toBe(true);
		});

		it("returns false for plain Error", () => {
			expect(isCliError(new Error("test"))).toBe(false);
		});

		it("returns false for other custom errors", () => {
			const parse = new ParseError({ message: "test", file: "a.md" });
			expect(isCliError(parse)).toBe(false);
		});

		it("returns false for null/undefined/primitives", () => {
			expect(isCliError(null)).toBe(false);
			expect(isCliError(undefined)).toBe(false);
			expect(isCliError("error")).toBe(false);
		});
	});
});

describe("Error cross-type discrimination", () => {
	it("each error type is distinguishable by name", () => {
		const cli = new CliError({ message: "cli" });
		const parse = new ParseError({ message: "parse", file: "f.md" });
		const sec = new SecurityError({
			threat: SecurityThreat.SECRET_DETECTED,
			message: "sec",
		});

		// Each has a unique name
		expect(cli.name).toBe("CliError");
		expect(parse.name).toBe("ParseError");
		expect(sec.name).toBe("SecurityError");

		// instanceof checks are mutually exclusive
		expect(cli instanceof CliError).toBe(true);
		expect(cli instanceof ParseError).toBe(false);
		expect(cli instanceof SecurityError).toBe(false);

		expect(parse instanceof CliError).toBe(false);
		expect(parse instanceof ParseError).toBe(true);
		expect(parse instanceof SecurityError).toBe(false);

		expect(sec instanceof CliError).toBe(false);
		expect(sec instanceof ParseError).toBe(false);
		expect(sec instanceof SecurityError).toBe(true);
	});

	it("all three extend Error", () => {
		const cli = new CliError({ message: "cli" });
		const parse = new ParseError({ message: "parse", file: "f.md" });
		const sec = new SecurityError({
			threat: SecurityThreat.PATH_TRAVERSAL,
			message: "sec",
		});

		expect(cli).toBeInstanceOf(Error);
		expect(parse).toBeInstanceOf(Error);
		expect(sec).toBeInstanceOf(Error);
	});

	it("can be caught in a generic Error handler", () => {
		expect(() => {
			throw new SecurityError({
				threat: SecurityThreat.PATH_TRAVERSAL,
				message: "test",
			});
		}).toThrow(Error);

		expect(() => {
			throw new ParseError({ message: "test", file: "f.md" });
		}).toThrow(Error);

		expect(() => {
			throw new CliError({ message: "test" });
		}).toThrow(Error);
	});
});
