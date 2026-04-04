import { CliError, ParseError, SecurityError, SecurityThreat } from "@dev-session/security";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleError } from "../utils/error-handler.js";

// Mock @clack/prompts log methods
vi.mock("@clack/prompts", () => ({
	log: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
		step: vi.fn(),
	},
}));

describe("handleError", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("handles SecurityError with exit code 3", async () => {
		const { log } = await import("@clack/prompts");
		const error = new SecurityError({
			message: "path traversal detected",
			threat: SecurityThreat.PATH_TRAVERSAL,
		});

		const code = handleError(error, { exit: false });

		expect(code).toBe(3);
		expect(log.error).toHaveBeenCalledWith("Security violation: path traversal detected");
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Threat type:"));
	});

	it("handles ParseError with exit code 2", async () => {
		const { log } = await import("@clack/prompts");
		const error = new ParseError({
			message: "invalid YAML",
			file: "SESSION_STATE.md",
			line: 5,
		});

		const code = handleError(error, { exit: false });

		expect(code).toBe(2);
		expect(log.error).toHaveBeenCalledWith("Parse error in SESSION_STATE.md:5: invalid YAML");
	});

	it("handles ParseError without line number", async () => {
		const { log } = await import("@clack/prompts");
		const error = new ParseError({
			message: "malformed frontmatter",
			file: "FILE_INDEX.md",
		});

		const code = handleError(error, { exit: false });

		expect(code).toBe(2);
		expect(log.error).toHaveBeenCalledWith("Parse error in FILE_INDEX.md: malformed frontmatter");
	});

	it("handles ParseError with empty file string", async () => {
		const { log } = await import("@clack/prompts");
		const error = new ParseError({
			message: "unexpected token",
			file: "",
		});

		const code = handleError(error, { exit: false });

		expect(code).toBe(2);
		expect(log.error).toHaveBeenCalledWith("Parse error in unknown file: unexpected token");
	});

	it("handles CliError with exit code 1", async () => {
		const { log } = await import("@clack/prompts");
		const error = new CliError({
			message: "no .session/ directory found",
			suggestion: "Run `npx dev-session init` to create one",
		});

		const code = handleError(error, { exit: false });

		expect(code).toBe(1);
		expect(log.error).toHaveBeenCalledWith("no .session/ directory found");
		expect(log.info).toHaveBeenCalledWith("Suggestion: Run `npx dev-session init` to create one");
	});

	it("handles CliError without suggestion", async () => {
		const { log } = await import("@clack/prompts");
		const error = new CliError({ message: "something went wrong" });

		const code = handleError(error, { exit: false });

		expect(code).toBe(1);
		expect(log.error).toHaveBeenCalledWith("something went wrong");
		expect(log.info).not.toHaveBeenCalled();
	});

	it("handles unknown Error with exit code 1", async () => {
		const { log } = await import("@clack/prompts");
		const error = new Error("kaboom");

		const code = handleError(error, { exit: false });

		expect(code).toBe(1);
		expect(log.error).toHaveBeenCalledWith("Unexpected error: kaboom");
	});

	it("handles non-Error unknown with exit code 1", async () => {
		const { log } = await import("@clack/prompts");

		const code = handleError("string error", { exit: false });

		expect(code).toBe(1);
		expect(log.error).toHaveBeenCalledWith("An unexpected error occurred.");
	});

	it("handles null/undefined with exit code 1", async () => {
		const codeNull = handleError(null, { exit: false });
		const codeUndef = handleError(undefined, { exit: false });

		expect(codeNull).toBe(1);
		expect(codeUndef).toBe(1);
	});
});
