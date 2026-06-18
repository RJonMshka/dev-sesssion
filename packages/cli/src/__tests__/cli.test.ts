import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createProgram } from "../cli.js";

// The version Commander reports must match the package's own package.json.
const pkgVersion = (
	JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
		version: string;
	}
).version;

// Mock @clack/prompts to avoid terminal output in tests
vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn(() => false),
	log: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
		step: vi.fn(),
	},
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		cancel: vi.fn(),
		error: vi.fn(),
		message: vi.fn(),
		clear: vi.fn(),
	})),
	text: vi.fn(),
	select: vi.fn(),
	confirm: vi.fn(),
	multiselect: vi.fn(),
	group: vi.fn(),
}));

// Mock the init command's action to prevent actual filesystem operations.
// The registerInitCommand function adds an async action that runs the full
// init flow, which we don't want during option-parsing tests.
vi.mock("@dev-session/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dev-session/core")>();
	return {
		...actual,
		ProjectDetector: {
			detect: vi.fn(() => ({
				tool: "unknown",
				project_type: "unknown",
				existing_files: [],
				project_root: "/tmp/test",
				has_existing_session: false,
			})),
			hasExistingSession: vi.fn(() => false),
			getProjectType: vi.fn(() => "unknown"),
		},
	};
});

/**
 * Helper: parse global options without triggering the init action.
 *
 * Uses `parseOptions()` to extract Commander options without running
 * the matched subcommand, avoiding unhandled async rejections.
 */
function parseGlobalOpts(args: string[] = []): ReturnType<typeof createProgram> {
	const program = createProgram();
	// We parse with allowUnknownOption so the subcommand action is never triggered,
	// but global options are still captured. We prepend "init" to ensure Commander
	// recognizes it as a valid subcommand for option parsing.
	program.allowUnknownOption(true);
	// Using parse in a way that only processes the options but we catch action errors
	const initCmd = program.commands.find((c) => c.name() === "init");
	// Temporarily replace the action to prevent execution
	if (initCmd) {
		// Remove all listeners for the init command to prevent execution
		initCmd.action(() => {
			// no-op — we only want to parse options
		});
	}
	program.parse(["init", ...args], { from: "user" });
	return program;
}

describe("createProgram", () => {
	it("creates a Commander program", () => {
		const program = createProgram();
		expect(program.name()).toBe("dev-sesssion");
	});

	it("reports the version from package.json", () => {
		const program = createProgram();
		expect(program.version()).toBe(pkgVersion);
	});

	it("has --cwd option defaulting to process.cwd()", () => {
		const program = parseGlobalOpts();
		const opts = program.opts<{ cwd: string }>();
		expect(opts.cwd).toBe(process.cwd());
	});

	it("has --yes option defaulting to false", () => {
		const program = parseGlobalOpts();
		const opts = program.opts<{ yes: boolean }>();
		expect(opts.yes).toBe(false);
	});

	it("has --dry-run option defaulting to false", () => {
		const program = parseGlobalOpts();
		const opts = program.opts<{ dryRun: boolean }>();
		expect(opts.dryRun).toBe(false);
	});

	it("has --verbose option defaulting to false", () => {
		const program = parseGlobalOpts();
		const opts = program.opts<{ verbose: boolean }>();
		expect(opts.verbose).toBe(false);
	});

	it("has --strict option defaulting to false", () => {
		const program = parseGlobalOpts();
		const opts = program.opts<{ strict: boolean }>();
		expect(opts.strict).toBe(false);
	});

	it("registers init command", () => {
		const program = createProgram();
		const initCmd = program.commands.find((c) => c.name() === "init");
		expect(initCmd).toBeDefined();
		expect(initCmd?.description()).toBe("Initialize dev-sesssion in the current project");
	});

	it("parses --cwd option", () => {
		const program = parseGlobalOpts(["--cwd", "/tmp/test"]);
		const opts = program.opts<{ cwd: string }>();
		expect(opts.cwd).toBe("/tmp/test");
	});

	it("parses -y shorthand for --yes", () => {
		const program = parseGlobalOpts(["-y"]);
		const opts = program.opts<{ yes: boolean }>();
		expect(opts.yes).toBe(true);
	});

	it("parses -v shorthand for --verbose", () => {
		const program = parseGlobalOpts(["-v"]);
		const opts = program.opts<{ verbose: boolean }>();
		expect(opts.verbose).toBe(true);
	});

	it("uses exitOverride to throw instead of exit", () => {
		const program = createProgram();
		// Passing --help should throw CommanderError instead of exiting
		expect(() => {
			program.parse(["--help"], { from: "user" });
		}).toThrow();
	});
});
