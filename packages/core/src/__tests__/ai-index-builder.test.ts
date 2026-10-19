/**
 * Unit tests for AiIndexBuilder.
 *
 * Tests:
 * - build: constructs AiIndex from ParsedFile[]
 * - merge: file added, removed, modified; project_root inherited
 * - serialize: deterministic byte-for-byte output on same input
 * - deserialize: roundtrip with serialize
 */

import { describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import type { AiIndex, ParsedFile, ParsedSymbol } from "../annotation/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = "/home/user/project";

function makeSymbol(overrides: Partial<ParsedSymbol> = {}): ParsedSymbol {
	return {
		name: "TestSymbol",
		surface: "public",
		summary: "A test symbol",
		signature: "export const TestSymbol = 42",
		line: 1,
		tags: [],
		...overrides,
	};
}

function makeParsedFile(relativePath: string, overrides: Partial<ParsedFile> = {}): ParsedFile {
	return {
		path: `${PROJECT_ROOT}/${relativePath}`,
		moduleSummary: "",
		exports: [],
		tokenCost: 100,
		tokenCostAccurate: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

describe("AiIndexBuilder.build", () => {
	it("returns an AiIndex with version '2'", () => {
		const index = AiIndexBuilder.build([], PROJECT_ROOT);
		expect(index.version).toBe("2");
	});

	it("sets project_root from argument", () => {
		const index = AiIndexBuilder.build([], PROJECT_ROOT);
		expect(index.project_root).toBe(PROJECT_ROOT);
	});

	it("sets generated_at to a valid ISO timestamp", () => {
		const before = new Date().toISOString();
		const index = AiIndexBuilder.build([], PROJECT_ROOT);
		const after = new Date().toISOString();
		expect(index.generated_at >= before).toBe(true);
		expect(index.generated_at <= after).toBe(true);
	});

	it("builds file entries from ParsedFile array", () => {
		const files = [
			makeParsedFile("src/a.ts", {
				exports: [makeSymbol({ name: "alpha" })],
				tokenCost: 42,
			}),
		];

		const index = AiIndexBuilder.build(files, PROJECT_ROOT);

		const entry = index.files["src/a.ts"];
		expect(entry).toBeDefined();
		expect(entry?.token_cost).toBe(42);
		expect(entry?.exports.alpha).toBeDefined();
	});

	it("converts ParsedSymbol to SymbolEntry correctly", () => {
		const sym: ParsedSymbol = {
			name: "MyClass",
			surface: "public",
			summary: "A class",
			signature: "export class MyClass",
			line: 10,
			tags: [],
		};

		const files = [makeParsedFile("src/b.ts", { exports: [sym] })];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT);

		const fileEntry = index.files["src/b.ts"];
		expect(fileEntry).toBeDefined();
		const symEntry = fileEntry?.exports.MyClass;
		expect(symEntry).toBeDefined();
		expect(symEntry?.surface).toBe("public");
		expect(symEntry?.summary).toBe("A class");
		expect(symEntry?.signature).toBe("export class MyClass");
		expect(symEntry?.line).toBe(10);
		expect(symEntry?.tags).toEqual([]);
	});

	it("uses tokenCosts override when provided", () => {
		const files = [makeParsedFile("src/c.ts", { tokenCost: 10 })];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT, { "src/c.ts": 999 });

		expect(index.files["src/c.ts"]?.token_cost).toBe(999);
		expect(index.files["src/c.ts"]?.token_cost_accurate).toBe(true);
	});

	it("falls back to ParsedFile tokenCost when no override", () => {
		const files = [makeParsedFile("src/d.ts", { tokenCost: 77 })];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT);

		expect(index.files["src/d.ts"]?.token_cost).toBe(77);
		expect(index.files["src/d.ts"]?.token_cost_accurate).toBe(false);
	});

	it("defaults layer_default to 1", () => {
		const files = [makeParsedFile("src/e.ts")];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT);
		expect(index.files["src/e.ts"]?.layer_default).toBe(1);
	});

	it("handles absolute paths to compute relative keys", () => {
		const files = [makeParsedFile("packages/core/src/index.ts")];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT);
		expect(index.files["packages/core/src/index.ts"]).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

describe("AiIndexBuilder.merge", () => {
	const existingIndex: AiIndex = {
		version: "2",
		generated_at: "2026-01-01T00:00:00.000Z",
		project_root: PROJECT_ROOT,
		files: {
			"src/a.ts": {
				module_summary: "File A",
				layer_default: 1,
				token_cost: 50,
				token_cost_accurate: false,
				exports: {},
			},
			"src/b.ts": {
				module_summary: "File B",
				layer_default: 1,
				token_cost: 60,
				token_cost_accurate: false,
				exports: {},
			},
		},
	};

	it("inherits project_root from existing index", () => {
		const updated: AiIndex = {
			...existingIndex,
			files: { "src/a.ts": existingIndex.files["src/a.ts"]! },
		};
		const merged = AiIndexBuilder.merge(existingIndex, updated);
		expect(merged.project_root).toBe(PROJECT_ROOT);
	});

	it("uses version '2'", () => {
		const merged = AiIndexBuilder.merge(existingIndex, existingIndex);
		expect(merged.version).toBe("2");
	});

	it("refreshes generated_at timestamp", () => {
		const before = new Date().toISOString();
		const merged = AiIndexBuilder.merge(existingIndex, existingIndex);
		const after = new Date().toISOString();
		expect(merged.generated_at >= before).toBe(true);
		expect(merged.generated_at <= after).toBe(true);
	});

	it("file added: new file appears in merged index", () => {
		const updatedIndex: AiIndex = {
			...existingIndex,
			files: {
				...existingIndex.files,
				"src/c.ts": {
					module_summary: "File C",
					layer_default: 1,
					token_cost: 70,
					token_cost_accurate: false,
					exports: {},
				},
			},
		};

		const merged = AiIndexBuilder.merge(existingIndex, updatedIndex);
		expect(merged.files["src/c.ts"]).toBeDefined();
		expect(merged.files["src/a.ts"]).toBeDefined();
	});

	it("file removed: absent from updated index is dropped", () => {
		// updated only has "src/a.ts" — "src/b.ts" was deleted
		const updatedIndex: AiIndex = {
			...existingIndex,
			files: {
				"src/a.ts": existingIndex.files["src/a.ts"]!,
			},
		};

		const merged = AiIndexBuilder.merge(existingIndex, updatedIndex);
		expect(merged.files["src/a.ts"]).toBeDefined();
		expect(merged.files["src/b.ts"]).toBeUndefined();
	});

	it("file modified: updated entry overrides existing", () => {
		const modifiedEntry = {
			...existingIndex.files["src/a.ts"]!,
			token_cost: 9999,
			module_summary: "Updated A",
		};

		const updatedIndex: AiIndex = {
			...existingIndex,
			files: {
				"src/a.ts": modifiedEntry,
				"src/b.ts": existingIndex.files["src/b.ts"]!,
			},
		};

		const merged = AiIndexBuilder.merge(existingIndex, updatedIndex);
		expect(merged.files["src/a.ts"]?.token_cost).toBe(9999);
		expect(merged.files["src/a.ts"]?.module_summary).toBe("Updated A");
	});
});

// ---------------------------------------------------------------------------
// serialize / deserialize
// ---------------------------------------------------------------------------

describe("AiIndexBuilder.serialize", () => {
	it("produces a non-empty YAML string", () => {
		const index = AiIndexBuilder.build([], PROJECT_ROOT);
		const yaml = AiIndexBuilder.serialize(index);
		expect(yaml).toBeTruthy();
		expect(yaml).toContain('version: "2"');
	});

	it("is deterministic: same input → same output", () => {
		const files = [
			makeParsedFile("src/z.ts", { exports: [makeSymbol({ name: "Zebra" })] }),
			makeParsedFile("src/a.ts", { exports: [makeSymbol({ name: "Alpha" })] }),
		];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT);

		// Freeze timestamps for deterministic test
		const frozen = { ...index, generated_at: "2026-04-14T00:00:00.000Z" };

		const yaml1 = AiIndexBuilder.serialize(frozen);
		const yaml2 = AiIndexBuilder.serialize(frozen);
		expect(yaml1).toBe(yaml2);
	});

	it("sorts file keys alphabetically", () => {
		const files = [
			makeParsedFile("src/z.ts"),
			makeParsedFile("src/a.ts"),
			makeParsedFile("src/m.ts"),
		];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT);
		const yaml = AiIndexBuilder.serialize(index);

		const aIdx = yaml.indexOf("src/a.ts");
		const mIdx = yaml.indexOf("src/m.ts");
		const zIdx = yaml.indexOf("src/z.ts");
		expect(aIdx).toBeLessThan(mIdx);
		expect(mIdx).toBeLessThan(zIdx);
	});

	it("sorts symbol keys alphabetically within a file", () => {
		const files = [
			makeParsedFile("src/f.ts", {
				exports: [
					makeSymbol({ name: "Zebra" }),
					makeSymbol({ name: "Alpha" }),
					makeSymbol({ name: "Mango" }),
				],
			}),
		];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT);
		const yaml = AiIndexBuilder.serialize(index);

		const alphaIdx = yaml.indexOf("Alpha:");
		const mangoIdx = yaml.indexOf("Mango:");
		const zebraIdx = yaml.indexOf("Zebra:");
		expect(alphaIdx).toBeLessThan(mangoIdx);
		expect(mangoIdx).toBeLessThan(zebraIdx);
	});
});

describe("AiIndexBuilder.deserialize", () => {
	it("roundtrips: serialize → deserialize → same files", () => {
		const files = [
			makeParsedFile("src/a.ts", {
				moduleSummary: "Module A",
				exports: [makeSymbol({ name: "FuncA", summary: "A function", line: 5 })],
				tokenCost: 128,
			}),
		];

		const built = AiIndexBuilder.build(files, PROJECT_ROOT);
		const frozen = { ...built, generated_at: "2026-04-14T00:00:00.000Z" };
		const yaml = AiIndexBuilder.serialize(frozen);
		const restored = AiIndexBuilder.deserialize(yaml);

		expect(restored.version).toBe("2");
		expect(restored.project_root).toBe(PROJECT_ROOT);
		expect(restored.files["src/a.ts"]).toBeDefined();
		expect(restored.files["src/a.ts"]?.module_summary).toBe("Module A");
		expect(restored.files["src/a.ts"]?.token_cost).toBe(128);
		expect(restored.files["src/a.ts"]?.exports.FuncA).toBeDefined();
		expect(restored.files["src/a.ts"]?.exports.FuncA?.summary).toBe("A function");
	});

	it("deserializes empty files map", () => {
		const index = AiIndexBuilder.build([], PROJECT_ROOT);
		const frozen = { ...index, generated_at: "2026-04-14T00:00:00.000Z" };
		const restored = AiIndexBuilder.deserialize(AiIndexBuilder.serialize(frozen));
		expect(Object.keys(restored.files)).toHaveLength(0);
	});

	it("throws ParseError on unsupported version", () => {
		const badYaml = `version: "1"\ngenerated_at: ""\nproject_root: ""\nfiles:\n`;
		expect(() => AiIndexBuilder.deserialize(badYaml)).toThrow();
	});

	it("handles special chars in file paths (slashes, dots)", () => {
		const files = [makeParsedFile("packages/core/src/index.ts")];
		const index = AiIndexBuilder.build(files, PROJECT_ROOT);
		const frozen = { ...index, generated_at: "2026-04-14T00:00:00.000Z" };
		const yaml = AiIndexBuilder.serialize(frozen);
		const restored = AiIndexBuilder.deserialize(yaml);
		expect(restored.files["packages/core/src/index.ts"]).toBeDefined();
	});
});
