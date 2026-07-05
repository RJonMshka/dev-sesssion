import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MonorepoDetector } from "../detectors/monorepo-detector.js";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, ".tmp-monorepo-"));
}

describe("MonorepoDetector", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Non-monorepo

	describe("no workspace files", () => {
		it("returns isMonorepo: false when no workspace config exists", () => {
			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(false);
			expect(info.type).toBe("none");
			expect(info.packages).toHaveLength(0);
		});

		it("isMonorepoRoot returns false for a plain project", () => {
			expect(MonorepoDetector.isMonorepoRoot(tmpDir)).toBe(false);
		});
	});

	// pnpm-workspace.yaml

	describe("pnpm-workspace.yaml", () => {
		it("detects pnpm workspace and resolves packages", () => {
			fs.mkdirSync(path.join(tmpDir, "packages", "core"), { recursive: true });
			fs.mkdirSync(path.join(tmpDir, "packages", "cli"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(true);
			expect(info.type).toBe("pnpm");
			expect(info.packages).toHaveLength(2);
			const paths = info.packages.map((p) => p.relativePath).sort();
			expect(paths).toEqual(["packages/cli", "packages/core"]);
		});

		it("reads package names from package.json within workspace packages", () => {
			fs.mkdirSync(path.join(tmpDir, "packages", "core"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpDir, "packages", "core", "package.json"),
				'{"name":"@repo/core"}',
			);
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.packages[0]?.name).toBe("@repo/core");
		});

		it("applies negation patterns to exclude matched directories", () => {
			fs.mkdirSync(path.join(tmpDir, "packages", "core"), { recursive: true });
			fs.mkdirSync(path.join(tmpDir, "packages", "excluded"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpDir, "pnpm-workspace.yaml"),
				"packages:\n  - 'packages/*'\n  - '!packages/excluded'\n",
			);

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.type).toBe("pnpm");
			const paths = info.packages.map((p) => p.relativePath);
			expect(paths).toContain("packages/core");
			expect(paths).not.toContain("packages/excluded");
		});

		it("handles double-quoted patterns", () => {
			fs.mkdirSync(path.join(tmpDir, "apps", "web"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.packages).toHaveLength(1);
			expect(info.packages[0]?.relativePath).toBe("apps/web");
		});

		it("handles unquoted patterns", () => {
			fs.mkdirSync(path.join(tmpDir, "libs", "utils"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - libs/*\n");

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.packages).toHaveLength(1);
			expect(info.packages[0]?.relativePath).toBe("libs/utils");
		});

		it("handles multiple glob patterns", () => {
			fs.mkdirSync(path.join(tmpDir, "packages", "core"), { recursive: true });
			fs.mkdirSync(path.join(tmpDir, "apps", "web"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpDir, "pnpm-workspace.yaml"),
				"packages:\n  - 'packages/*'\n  - 'apps/*'\n",
			);

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.packages).toHaveLength(2);
		});

		it("does not include hidden directories (dot-prefixed)", () => {
			fs.mkdirSync(path.join(tmpDir, "packages", "core"), { recursive: true });
			fs.mkdirSync(path.join(tmpDir, "packages", ".hidden"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");

			const info = MonorepoDetector.detect(tmpDir);
			const names = info.packages.map((p) => p.relativePath);
			expect(names).toContain("packages/core");
			expect(names.some((n) => n.includes(".hidden"))).toBe(false);
		});

		it("returns empty packages when glob dir does not exist", () => {
			fs.writeFileSync(
				path.join(tmpDir, "pnpm-workspace.yaml"),
				"packages:\n  - 'nonexistent/*'\n",
			);

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(true);
			expect(info.packages).toHaveLength(0);
		});

		it("absolute paths are correctly set", () => {
			fs.mkdirSync(path.join(tmpDir, "packages", "core"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.packages[0]?.absolutePath).toBe(path.join(tmpDir, "packages", "core"));
		});

		it("ignores complex patterns with multiple wildcards", () => {
			fs.writeFileSync(
				path.join(tmpDir, "pnpm-workspace.yaml"),
				"packages:\n  - 'packages/**/*'\n",
			);

			const info = MonorepoDetector.detect(tmpDir);
			// Complex pattern is skipped gracefully
			expect(info.isMonorepo).toBe(true);
			expect(info.packages).toHaveLength(0);
		});

		it("handles literal directory patterns", () => {
			fs.mkdirSync(path.join(tmpDir, "shared"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'shared'\n");

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.packages).toHaveLength(1);
			expect(info.packages[0]?.relativePath).toBe("shared");
		});

		it("pnpm takes priority over nx.json", () => {
			fs.mkdirSync(path.join(tmpDir, "packages", "a"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
			fs.writeFileSync(path.join(tmpDir, "nx.json"), "{}");

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.type).toBe("pnpm");
		});
	});

	// nx.json

	describe("nx.json", () => {
		it("detects nx workspace", () => {
			fs.writeFileSync(path.join(tmpDir, "nx.json"), "{}");
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({ name: "my-nx-repo", workspaces: ["packages/*"] }),
			);
			fs.mkdirSync(path.join(tmpDir, "packages", "lib"), { recursive: true });

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(true);
			expect(info.type).toBe("nx");
			expect(info.packages).toHaveLength(1);
		});

		it("returns isMonorepo: true with no packages if no workspaces in package.json", () => {
			fs.writeFileSync(path.join(tmpDir, "nx.json"), "{}");
			fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"nx-repo"}');

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(true);
			expect(info.type).toBe("nx");
			expect(info.packages).toHaveLength(0);
		});
	});

	// turbo.json

	describe("turbo.json", () => {
		it("detects turborepo workspace via turbo.json", () => {
			fs.writeFileSync(path.join(tmpDir, "turbo.json"), "{}");
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({ name: "my-turbo-repo", workspaces: ["apps/*"] }),
			);
			fs.mkdirSync(path.join(tmpDir, "apps", "web"), { recursive: true });

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(true);
			expect(info.type).toBe("turborepo");
			expect(info.packages).toHaveLength(1);
			expect(info.packages[0]?.relativePath).toBe("apps/web");
		});

		it("nx.json takes priority over turbo.json", () => {
			fs.writeFileSync(path.join(tmpDir, "nx.json"), "{}");
			fs.writeFileSync(path.join(tmpDir, "turbo.json"), "{}");

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.type).toBe("nx");
		});
	});

	// npm / yarn workspaces (package.json only)

	describe("package.json workspaces", () => {
		it("detects npm workspaces (plain array)", () => {
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({ name: "my-npm-mono", workspaces: ["packages/*"] }),
			);
			fs.mkdirSync(path.join(tmpDir, "packages", "a"), { recursive: true });

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(true);
			expect(info.type).toBe("npm");
			expect(info.packages).toHaveLength(1);
		});

		it("detects yarn workspaces (nested format)", () => {
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({
					name: "my-yarn-mono",
					workspaces: { packages: ["packages/*"] },
				}),
			);
			fs.mkdirSync(path.join(tmpDir, "packages", "shared"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "");

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(true);
			expect(info.type).toBe("yarn");
			expect(info.packages).toHaveLength(1);
		});

		it("returns npm when yarn.lock is absent", () => {
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({ workspaces: ["packages/*"] }),
			);

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.type).toBe("npm");
		});

		it("returns type none when workspaces array is empty", () => {
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({ name: "my-pkg", workspaces: [] }),
			);

			const info = MonorepoDetector.detect(tmpDir);
			expect(info.isMonorepo).toBe(false);
			expect(info.type).toBe("none");
		});
	});

	// isMonorepoRoot

	describe("isMonorepoRoot", () => {
		it("returns true when pnpm-workspace.yaml is present", () => {
			fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
			expect(MonorepoDetector.isMonorepoRoot(tmpDir)).toBe(true);
		});

		it("returns false for a plain Node project", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"plain"}');
			expect(MonorepoDetector.isMonorepoRoot(tmpDir)).toBe(false);
		});
	});
});
