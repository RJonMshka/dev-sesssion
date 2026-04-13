import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextLinter } from "../linters/context-linter.js";

// ---------------------------------------------------------------------------
// detectDuplicates
// ---------------------------------------------------------------------------

describe("ContextLinter.detectDuplicates", () => {
	it("returns empty array when no duplicates exist", () => {
		const files = {
			"a.md": "This is file A\nWith unique content\nNo duplicates here",
			"b.md": "This is file B\nCompletely different\nNo matches at all",
		};
		const results = ContextLinter.detectDuplicates(files);
		expect(results).toHaveLength(0);
	});

	it("detects duplicate 3-line blocks across two files", () => {
		const sharedBlock =
			"Important rule: never do X\nAlways validate input\nCheck for null values first";
		const files = {
			"a.md": `Intro line\n${sharedBlock}\nSome unique content`,
			"b.md": `Different intro\n${sharedBlock}\nOther unique content`,
		};
		const results = ContextLinter.detectDuplicates(files);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.severity).toBe("warning");
		expect(results[0]?.rule).toBe("no-duplicate-blocks");
	});

	it("normalizes case when comparing blocks", () => {
		const files = {
			"a.md": "IMPORTANT RULE: NEVER DO X\nALWAYS VALIDATE INPUT\nCHECK FOR NULL VALUES FIRST",
			"b.md": "important rule: never do x\nalways validate input\ncheck for null values first",
		};
		const results = ContextLinter.detectDuplicates(files);
		expect(results.length).toBeGreaterThan(0);
	});

	it("returns empty array with a single file", () => {
		const files = {
			"a.md": "Line one\nLine two\nLine three\nLine four",
		};
		const results = ContextLinter.detectDuplicates(files);
		expect(results).toHaveLength(0);
	});

	it("returns empty array for empty file map", () => {
		const results = ContextLinter.detectDuplicates({});
		expect(results).toHaveLength(0);
	});

	it("does not flag short blocks below minimum length", () => {
		// Very short lines that normalize to < 30 chars total
		const files = {
			"a.md": "a\nb\nc\nd",
			"b.md": "a\nb\nc\nd",
		};
		const results = ContextLinter.detectDuplicates(files);
		expect(results).toHaveLength(0);
	});

	it("reports the file that contains the duplicate", () => {
		const sharedBlock =
			"This is a substantial shared block that exceeds minimum length\nAnd continues here with more words\nAnd even more content in the third line here";
		const files = {
			"file-a.md": `Unique header\n${sharedBlock}`,
			"file-b.md": `Different header\n${sharedBlock}`,
		};
		const results = ContextLinter.detectDuplicates(files);
		expect(results.length).toBeGreaterThan(0);
		// One of the files should be the reported file
		const reportedFiles = results.map((r) => r.file);
		expect(reportedFiles.some((f) => f === "file-a.md" || f === "file-b.md")).toBe(true);
	});

	it("mentions the other file in the message", () => {
		const sharedBlock =
			"This is a substantial shared block that exceeds minimum length\nAnd continues here with more words\nAnd even more content in the third line here";
		const files = {
			"file-a.md": `Unique header\n${sharedBlock}`,
			"file-b.md": `Different header\n${sharedBlock}`,
		};
		const results = ContextLinter.detectDuplicates(files);
		expect(results.length).toBeGreaterThan(0);
		const message = results[0]?.message ?? "";
		// Should mention the other file
		expect(message).toMatch(/file-[ab]\.md/);
	});
});

// ---------------------------------------------------------------------------
// detectSoftLanguage
// ---------------------------------------------------------------------------

describe("ContextLinter.detectSoftLanguage", () => {
	it("returns empty array for clean content", () => {
		const content =
			"Use atomic writes for all file operations.\nValidate all input paths.\nThrow SecurityError on violations.";
		const results = ContextLinter.detectSoftLanguage("rules.md", content);
		expect(results).toHaveLength(0);
	});

	it("flags 'maybe' on the correct line", () => {
		const content = "Line one\nMaybe consider this approach\nLine three";
		const results = ContextLinter.detectSoftLanguage("rules.md", content);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.severity).toBe("info");
		expect(results[0]?.rule).toBe("no-soft-language");
		expect(results[0]?.line).toBe(2);
		expect(results[0]?.file).toBe("rules.md");
	});

	it("flags 'possibly' as soft language", () => {
		const content = "possibly the best approach here";
		const results = ContextLinter.detectSoftLanguage("doc.md", content);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.message).toContain("possibly");
	});

	it("flags 'perhaps' as soft language", () => {
		const content = "perhaps we should add error handling";
		const results = ContextLinter.detectSoftLanguage("doc.md", content);
		expect(results.length).toBeGreaterThan(0);
	});

	it("flags 'consider using' as soft language", () => {
		const content = "consider using the atomic writer here";
		const results = ContextLinter.detectSoftLanguage("doc.md", content);
		expect(results.length).toBeGreaterThan(0);
	});

	it("reports one finding per line maximum", () => {
		// Line has both 'maybe' and 'possibly'
		const content = "maybe possibly this is soft";
		const results = ContextLinter.detectSoftLanguage("doc.md", content);
		// Should not double-report for the same line
		expect(results.length).toBe(1);
	});

	it("handles empty content", () => {
		const results = ContextLinter.detectSoftLanguage("empty.md", "");
		expect(results).toHaveLength(0);
	});

	it("is case-insensitive", () => {
		const content = "MAYBE we should do this";
		const results = ContextLinter.detectSoftLanguage("doc.md", content);
		expect(results.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// detectDeadReferences
// ---------------------------------------------------------------------------

describe("ContextLinter.detectDeadReferences", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-linter-"));
		// Create some real files
		fs.writeFileSync(path.join(tmpDir, "real-file.ts"), "export const x = 1;");
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export {};");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns empty array when content has no @mentions", () => {
		const content = "No file references here\nJust plain text";
		const results = ContextLinter.detectDeadReferences("doc.md", content, tmpDir);
		expect(results).toHaveLength(0);
	});

	it("returns empty array when @mentioned file exists", () => {
		const content = "Load @real-file.ts for context";
		const results = ContextLinter.detectDeadReferences("doc.md", content, tmpDir);
		expect(results).toHaveLength(0);
	});

	it("returns empty array when nested @mentioned file exists", () => {
		const content = "Load @src/index.ts for context";
		const results = ContextLinter.detectDeadReferences("doc.md", content, tmpDir);
		expect(results).toHaveLength(0);
	});

	it("flags a non-existent @mention as an error", () => {
		const content = "Load @missing-file.ts for context";
		const results = ContextLinter.detectDeadReferences("doc.md", content, tmpDir);
		expect(results.length).toBe(1);
		expect(results[0]?.severity).toBe("error");
		expect(results[0]?.rule).toBe("no-dead-references");
		expect(results[0]?.file).toBe("doc.md");
		expect(results[0]?.message).toContain("missing-file.ts");
	});

	it("reports the correct line number", () => {
		const content = "First line\n@nonexistent.ts here\nThird line";
		const results = ContextLinter.detectDeadReferences("doc.md", content, tmpDir);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.line).toBe(2);
	});

	it("flags multiple dead references in the same file", () => {
		const content = "@ghost1.ts\n@ghost2.ts\n@ghost3.ts";
		const results = ContextLinter.detectDeadReferences("doc.md", content, tmpDir);
		expect(results.length).toBe(3);
	});

	it("does not flag @mentions without file extensions", () => {
		// @username — no dot extension — should not match
		const content = "Assigned to @john for review";
		const results = ContextLinter.detectDeadReferences("doc.md", content, tmpDir);
		expect(results).toHaveLength(0);
	});

	it("handles empty content", () => {
		const results = ContextLinter.detectDeadReferences("doc.md", "", tmpDir);
		expect(results).toHaveLength(0);
	});
});
