/**
 * Unit tests for AutoExtractor.
 *
 * Tests:
 * - All export kinds (function, class, const, type alias, interface)
 * - Existing JSDoc summary extraction
 * - Parse error handling (returns empty result, does not throw)
 * - Directory extraction (uses walker, skips non-TS/JS files)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoExtractor } from "../annotation/auto-extractor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-extractor-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTsFile(filename: string, content: string): ValidatedPath {
	const filePath = path.join(tmpDir, filename);
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath as ValidatedPath;
}

// ---------------------------------------------------------------------------
// AutoExtractor.extractFile
// ---------------------------------------------------------------------------

describe("AutoExtractor.extractFile", () => {
	const extractor = new AutoExtractor();

	it("extracts exported function declaration", () => {
		const filePath = writeTsFile(
			"funcs.ts",
			`
export function greet(name: string): string {
  return "Hello, " + name;
}
`.trim(),
		);

		const result = extractor.extractFile(filePath);
		expect(result.exports).toHaveLength(1);
		const sym = result.exports[0]!;
		expect(sym.name).toBe("greet");
		expect(sym.surface).toBe("public");
		expect(sym.line).toBe(1);
		expect(sym.signature).toContain("function greet");
		expect(sym.tags).toEqual([]);
	});

	it("extracts exported class declaration", () => {
		const filePath = writeTsFile(
			"classes.ts",
			`
export class Foo extends Bar {
  constructor() { super(); }
}
`.trim(),
		);

		const result = extractor.extractFile(filePath);
		expect(result.exports).toHaveLength(1);
		expect(result.exports[0]?.name).toBe("Foo");
		expect(result.exports[0]?.signature).toContain("class Foo extends Bar");
	});

	it("extracts exported const declaration", () => {
		const filePath = writeTsFile(
			"consts.ts",
			`
export const MY_VALUE = 42;
`.trim(),
		);

		const result = extractor.extractFile(filePath);
		expect(result.exports).toHaveLength(1);
		expect(result.exports[0]?.name).toBe("MY_VALUE");
	});

	it("extracts exported type alias", () => {
		const filePath = writeTsFile(
			"types.ts",
			`
export type MyType = string | number;
`.trim(),
		);

		const result = extractor.extractFile(filePath);
		expect(result.exports).toHaveLength(1);
		expect(result.exports[0]?.name).toBe("MyType");
		expect(result.exports[0]?.signature).toContain("type MyType");
	});

	it("extracts exported interface", () => {
		const filePath = writeTsFile(
			"interfaces.ts",
			`
export interface MyInterface {
  foo: string;
  bar: number;
}
`.trim(),
		);

		const result = extractor.extractFile(filePath);
		expect(result.exports).toHaveLength(1);
		expect(result.exports[0]?.name).toBe("MyInterface");
		expect(result.exports[0]?.signature).toContain("interface MyInterface");
	});

	it("extracts JSDoc summary from existing /** */ block", () => {
		const filePath = writeTsFile(
			"with-jsdoc.ts",
			`
/**
 * Computes the sum of two numbers.
 *
 * @param a - First operand.
 * @param b - Second operand.
 * @returns The sum.
 */
export function add(a: number, b: number): number {
  return a + b;
}
`.trim(),
		);

		const result = extractor.extractFile(filePath);
		expect(result.exports[0]?.summary).toBe("Computes the sum of two numbers.");
	});

	it("returns empty summary for unannotated export", () => {
		const filePath = writeTsFile("no-jsdoc.ts", `export const x = 1;`);

		const result = extractor.extractFile(filePath);
		expect(result.exports[0]?.summary).toBe("");
	});

	it("extracts module summary from @packageDocumentation block", () => {
		const filePath = writeTsFile(
			"pkg-doc.ts",
			`/**
 * Core utility module for dev-session.
 *
 * @packageDocumentation
 */

export const VERSION = "1.0.0";
`,
		);

		const result = extractor.extractFile(filePath);
		expect(result.moduleSummary).toBe("Core utility module for dev-session.");
	});

	it("returns empty exports on parse error, does not throw", () => {
		const filePath = writeTsFile(
			"invalid.ts",
			`
this is not valid typescript at all @@@
export const broken
`.trim(),
		);

		const result = extractor.extractFile(filePath);
		expect(result.exports).toEqual([]);
		expect(result.moduleSummary).toBe("");
		// Token cost should still be estimated from source
		expect(result.tokenCost).toBeGreaterThan(0);
	});

	it("skips unsupported file extensions (returns empty exports)", () => {
		const filePath = path.join(tmpDir, "config.json") as ValidatedPath;
		fs.writeFileSync(filePath, '{"key": "value"}', "utf-8");

		const result = extractor.extractFile(filePath);
		expect(result.exports).toEqual([]);
	});

	it("extracts multiple exports from one file", () => {
		const filePath = writeTsFile(
			"multi.ts",
			`
/** First function. */
export function alpha() {}

/** Second function. */
export function beta() {}

export const GAMMA = "g";
`.trim(),
		);

		const result = extractor.extractFile(filePath);
		expect(result.exports).toHaveLength(3);
		const names = result.exports.map((s) => s.name).sort();
		expect(names).toEqual(["GAMMA", "alpha", "beta"]);
	});

	it("reports token cost as heuristic (not accurate)", () => {
		const filePath = writeTsFile("simple.ts", "export const x = 1;\n");

		const result = extractor.extractFile(filePath);
		expect(result.tokenCostAccurate).toBe(false);
		expect(result.tokenCost).toBeGreaterThan(0);
	});

	it("ignores specifier-only re-exports (export { foo } from ...)", () => {
		const filePath = writeTsFile("reexports.ts", `export { foo, bar } from "./other.js";`);

		const result = extractor.extractFile(filePath);
		// Specifier-only exports are skipped (no declaration to parse)
		expect(result.exports).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// AutoExtractor.extractDirectory
// ---------------------------------------------------------------------------

describe("AutoExtractor.extractDirectory", () => {
	const extractor = new AutoExtractor();

	it("walks directory and returns results for each TS file", async () => {
		writeTsFile("a.ts", "export const a = 1;");
		writeTsFile("b.ts", "export function b() {}");

		const results = await extractor.extractDirectory(tmpDir as ValidatedPath);

		expect(results).toHaveLength(2);
		const names = results.flatMap((r) => r.exports.map((e) => e.name));
		expect(names).toContain("a");
		expect(names).toContain("b");
	});

	it("skips non-TS/JS files during directory walk", async () => {
		writeTsFile("app.ts", "export const x = 1;");
		fs.writeFileSync(path.join(tmpDir, "readme.md"), "# Hello", "utf-8");
		fs.writeFileSync(path.join(tmpDir, "data.json"), '{"key": 1}', "utf-8");

		const results = await extractor.extractDirectory(tmpDir as ValidatedPath);

		expect(results).toHaveLength(1);
	});

	it("respects maxFiles option", async () => {
		writeTsFile("x.ts", "export const x = 1;");
		writeTsFile("y.ts", "export const y = 2;");
		writeTsFile("z.ts", "export const z = 3;");

		const results = await extractor.extractDirectory(tmpDir as ValidatedPath, {
			maxFiles: 2,
		});

		expect(results).toHaveLength(2);
	});

	it("continues past parse errors in directory walk", async () => {
		writeTsFile("good.ts", "export const good = 1;");
		writeTsFile("bad.ts", "this @@@@ is not valid typescript!!");

		const results = await extractor.extractDirectory(tmpDir as ValidatedPath);

		expect(results).toHaveLength(2);
		// The bad file contributes 0 exports but doesn't crash the walk
		const goodResult = results.find((r) => r.exports.length > 0);
		expect(goodResult).toBeDefined();
	});
});
