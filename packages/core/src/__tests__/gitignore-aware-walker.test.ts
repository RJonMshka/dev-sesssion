import * as fs from "node:fs";
import * as path from "node:path";
import { CliError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitignoreAwareWalker } from "../walkers/gitignore-aware-walker.js";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, ".tmp-"));
}

function writeFile(dir: string, relativePath: string, content = "test"): void {
	const fullPath = path.join(dir, relativePath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content);
}

describe("GitignoreAwareWalker", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("walk", () => {
		it("finds files in directory tree", () => {
			writeFile(tmpDir, "a.ts", "const a = 1;");
			writeFile(tmpDir, "src/b.ts", "const b = 2;");
			writeFile(tmpDir, "src/c.ts", "const c = 3;");

			const files = GitignoreAwareWalker.walk(tmpDir);

			expect(files).toHaveLength(3);
			const paths = files.map((f) => f.relativePath);
			expect(paths).toContain("a.ts");
			expect(paths).toContain("src/b.ts");
			expect(paths).toContain("src/c.ts");
		});

		it("always ignores node_modules", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "node_modules/pkg/index.js");

			const files = GitignoreAwareWalker.walk(tmpDir);
			const paths = files.map((f) => f.relativePath);

			expect(paths).toContain("a.ts");
			expect(paths).not.toContain("node_modules/pkg/index.js");
		});

		it("always ignores .git", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, ".git/config");

			const files = GitignoreAwareWalker.walk(tmpDir);
			const paths = files.map((f) => f.relativePath);

			expect(paths).not.toContain(".git/config");
		});

		it("always ignores dist and build", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "dist/bundle.js");
			writeFile(tmpDir, "build/output.js");

			const files = GitignoreAwareWalker.walk(tmpDir);
			const paths = files.map((f) => f.relativePath);

			expect(paths).not.toContain("dist/bundle.js");
			expect(paths).not.toContain("build/output.js");
		});

		it("respects .gitignore patterns", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "debug.log");
			writeFile(tmpDir, ".gitignore", "*.log\n");

			const files = GitignoreAwareWalker.walk(tmpDir);
			const paths = files.map((f) => f.relativePath);

			expect(paths).toContain("a.ts");
			expect(paths).not.toContain("debug.log");
		});

		it("respects directory patterns in .gitignore", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "coverage/lcov.info");
			writeFile(tmpDir, ".gitignore", "coverage/\n");

			const files = GitignoreAwareWalker.walk(tmpDir);
			const paths = files.map((f) => f.relativePath);

			expect(paths).toContain("a.ts");
			expect(paths).not.toContain("coverage/lcov.info");
		});

		it("applies additional ignore patterns from options", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "temp.txt");

			const files = GitignoreAwareWalker.walk(tmpDir, {
				ignore: ["*.txt"],
			});
			const paths = files.map((f) => f.relativePath);

			expect(paths).toContain("a.ts");
			expect(paths).not.toContain("temp.txt");
		});

		it("filters by extensions", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "b.js");
			writeFile(tmpDir, "c.md");

			const files = GitignoreAwareWalker.walk(tmpDir, {
				extensions: [".ts", ".md"],
			});
			const paths = files.map((f) => f.relativePath);

			expect(paths).toContain("a.ts");
			expect(paths).toContain("c.md");
			expect(paths).not.toContain("b.js");
		});

		it("respects maxDepth", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "src/b.ts");
			writeFile(tmpDir, "src/deep/c.ts");

			const files = GitignoreAwareWalker.walk(tmpDir, { maxDepth: 1 });
			const paths = files.map((f) => f.relativePath);

			expect(paths).toContain("a.ts");
			expect(paths).not.toContain("src/deep/c.ts");
		});

		it("sorts files by relative path", () => {
			writeFile(tmpDir, "z.ts");
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "m.ts");

			const files = GitignoreAwareWalker.walk(tmpDir);
			expect(files[0]?.relativePath).toBe("a.ts");
			expect(files[1]?.relativePath).toBe("m.ts");
			expect(files[2]?.relativePath).toBe("z.ts");
		});

		it("reports file sizes", () => {
			const content = "hello world";
			writeFile(tmpDir, "a.txt", content);

			const files = GitignoreAwareWalker.walk(tmpDir);
			expect(files[0]?.sizeBytes).toBe(Buffer.byteLength(content));
		});

		it("throws CliError for nonexistent directory", () => {
			expect(() => GitignoreAwareWalker.walk("/nonexistent/path/xyz")).toThrow(CliError);
		});

		it("handles empty directories", () => {
			const files = GitignoreAwareWalker.walk(tmpDir);
			expect(files).toEqual([]);
		});
	});

	describe("groupByDirectory", () => {
		it("groups files by parent directory", () => {
			writeFile(tmpDir, "a.ts");
			writeFile(tmpDir, "b.ts");
			writeFile(tmpDir, "src/c.ts");
			writeFile(tmpDir, "src/d.ts");

			const files = GitignoreAwareWalker.walk(tmpDir);
			const groups = GitignoreAwareWalker.groupByDirectory(files);

			expect(groups).toHaveLength(2);

			const rootGroup = groups.find((g) => g.directory === ".");
			expect(rootGroup?.files).toHaveLength(2);

			const srcGroup = groups.find((g) => g.directory === "src");
			expect(srcGroup?.files).toHaveLength(2);
		});

		it("computes totalSizeBytes per group", () => {
			writeFile(tmpDir, "a.ts", "12345");
			writeFile(tmpDir, "b.ts", "67890");

			const files = GitignoreAwareWalker.walk(tmpDir);
			const groups = GitignoreAwareWalker.groupByDirectory(files);

			expect(groups[0]?.totalSizeBytes).toBe(10);
		});

		it("sorts groups by directory path", () => {
			writeFile(tmpDir, "z/a.ts");
			writeFile(tmpDir, "a/b.ts");
			writeFile(tmpDir, "m/c.ts");

			const files = GitignoreAwareWalker.walk(tmpDir);
			const groups = GitignoreAwareWalker.groupByDirectory(files);

			const dirs = groups.map((g) => g.directory);
			expect(dirs).toEqual([...dirs].sort());
		});
	});

	describe("estimateTokenCost", () => {
		it("estimates ~1 token per 4 bytes", () => {
			const file = { relativePath: "a.ts", absolutePath: "/a.ts", sizeBytes: 1000 };
			expect(GitignoreAwareWalker.estimateTokenCost(file)).toBe(250);
		});

		it("rounds up for non-divisible sizes", () => {
			const file = { relativePath: "a.ts", absolutePath: "/a.ts", sizeBytes: 7 };
			expect(GitignoreAwareWalker.estimateTokenCost(file)).toBe(2);
		});

		it("returns 0 for empty files", () => {
			const file = { relativePath: "a.ts", absolutePath: "/a.ts", sizeBytes: 0 };
			expect(GitignoreAwareWalker.estimateTokenCost(file)).toBe(0);
		});
	});
});
