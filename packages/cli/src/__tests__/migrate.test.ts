/**
 * Tests for the `dev-session migrate` command.
 *
 * These tests mock @clack/prompts and verify the command's detection and
 * init-dispatching logic without running full init flows.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
	})),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		step: vi.fn(),
	},
	multiselect: vi.fn(),
	isCancel: vi.fn(() => false),
	cancel: vi.fn(),
}));

// Mock init so we don't run a full init wizard in unit tests
vi.mock("../commands/init.js", () => ({
	runInit: vi.fn().mockResolvedValue(undefined),
}));

import { multiselect } from "@clack/prompts";
import { runInit } from "../commands/init.js";
import { runMigrate } from "../commands/migrate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "migrate-test-"));
}

function createPnpmMonorepo(rootDir: string, packageDirs: string[]): void {
	const patterns = [...new Set(packageDirs.map((d) => d.split("/")[0] + "/*"))];
	fs.writeFileSync(
		path.join(rootDir, "pnpm-workspace.yaml"),
		`packages:\n${patterns.map((p) => `  - '${p}'`).join("\n")}\n`,
	);
	for (const dir of packageDirs) {
		fs.mkdirSync(path.join(rootDir, dir), { recursive: true });
	}
}

const BASE_OPTS = {
	yes: true,
	dryRun: false,
	verbose: false,
	strict: false,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMigrate", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		vi.clearAllMocks();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("exits early when no monorepo is detected", async () => {
		await runMigrate({ ...BASE_OPTS, cwd: tmpDir });

		expect(runInit).not.toHaveBeenCalled();
	});

	it("exits early when all packages already have .session/", async () => {
		createPnpmMonorepo(tmpDir, ["packages/core"]);
		fs.mkdirSync(path.join(tmpDir, "packages", "core", ".session"), { recursive: true });

		await runMigrate({ ...BASE_OPTS, cwd: tmpDir });

		expect(runInit).not.toHaveBeenCalled();
	});

	it("calls runInit for each package that lacks .session/ in --yes mode", async () => {
		createPnpmMonorepo(tmpDir, ["packages/core", "packages/cli"]);

		await runMigrate({ ...BASE_OPTS, cwd: tmpDir });

		expect(runInit).toHaveBeenCalledTimes(2);
	});

	it("passes correct cwd to runInit for each package", async () => {
		createPnpmMonorepo(tmpDir, ["packages/core"]);

		await runMigrate({ ...BASE_OPTS, cwd: tmpDir });

		expect(runInit).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: path.join(tmpDir, "packages", "core"),
			}),
		);
	});

	it("skips already-initialized packages when some are done", async () => {
		createPnpmMonorepo(tmpDir, ["packages/core", "packages/cli"]);
		// Mark core as already initialized
		fs.mkdirSync(path.join(tmpDir, "packages", "core", ".session"), { recursive: true });

		await runMigrate({ ...BASE_OPTS, cwd: tmpDir });

		// Only cli should be initialized
		expect(runInit).toHaveBeenCalledTimes(1);
		expect(runInit).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: path.join(tmpDir, "packages", "cli"),
			}),
		);
	});

	it("forwards adapter option to runInit", async () => {
		createPnpmMonorepo(tmpDir, ["packages/core"]);

		await runMigrate({ ...BASE_OPTS, cwd: tmpDir, adapter: "claude" });

		expect(runInit).toHaveBeenCalledWith(
			expect.objectContaining({ adapter: "claude" }),
		);
	});

	it("respects package selections from multiselect prompt", async () => {
		createPnpmMonorepo(tmpDir, ["packages/core", "packages/cli"]);
		vi.mocked(multiselect).mockResolvedValue(["packages/core"]);

		await runMigrate({ ...BASE_OPTS, yes: false, cwd: tmpDir });

		expect(runInit).toHaveBeenCalledTimes(1);
		expect(runInit).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: path.join(tmpDir, "packages", "core"),
			}),
		);
	});

	it("continues with remaining packages when one fails", async () => {
		createPnpmMonorepo(tmpDir, ["packages/core", "packages/cli"]);
		vi.mocked(runInit)
			.mockRejectedValueOnce(new Error("init failed"))
			.mockResolvedValueOnce(undefined);

		// Should not throw
		await expect(runMigrate({ ...BASE_OPTS, cwd: tmpDir })).resolves.not.toThrow();
	});

	it("passes dryRun flag through to runInit", async () => {
		createPnpmMonorepo(tmpDir, ["packages/core"]);

		await runMigrate({ ...BASE_OPTS, dryRun: true, cwd: tmpDir });

		expect(runInit).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: true }),
		);
	});
});
