/**
 * Integration tests for AutoExtractor + AnnotationParser (Chunk 13).
 *
 * Verifies that `@ai-*` override tags flow transparently through extraction
 * on a mixed annotated/unannotated fixture, and that unannotated exports keep
 * their auto-extracted defaults.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoExtractor } from "../annotation/auto-extractor.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-extractor-ann-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTsFile(filename: string, content: string): ValidatedPath {
	const filePath = path.join(tmpDir, filename);
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath as ValidatedPath;
}

const extractor = new AutoExtractor();

describe("AutoExtractor — @ai-* annotation overrides", () => {
	it("applies @ai-surface to mark an export private", () => {
		const file = writeTsFile(
			"surface.ts",
			`
/**
 * Internal helper, not part of the public API.
 * @ai-surface private
 */
export function internalHelper(): void {}
`.trim(),
		);

		const sym = extractor.extractFile(file).exports[0];
		expect(sym?.name).toBe("internalHelper");
		expect(sym?.surface).toBe("private");
	});

	it("lets @ai-summary override the auto-extracted JSDoc summary", () => {
		const file = writeTsFile(
			"summary.ts",
			`
/**
 * This first sentence would normally win.
 * @ai-summary Concise override summary.
 */
export class Widget {}
`.trim(),
		);

		const sym = extractor.extractFile(file).exports[0];
		expect(sym?.summary).toBe("Concise override summary.");
	});

	it("populates tags from @ai-tag", () => {
		const file = writeTsFile(
			"tags.ts",
			`
/**
 * Experimental API.
 * @ai-tag experimental
 * @ai-tag unstable
 */
export const featureFlag = true;
`.trim(),
		);

		const sym = extractor.extractFile(file).exports[0];
		expect(sym?.tags).toEqual(["experimental", "unstable"]);
	});

	it("leaves unannotated exports at their auto-extracted defaults", () => {
		const file = writeTsFile(
			"plain.ts",
			`
/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}
`.trim(),
		);

		const sym = extractor.extractFile(file).exports[0];
		expect(sym?.surface).toBe("public");
		expect(sym?.summary).toBe("Adds two numbers.");
		expect(sym?.tags).toEqual([]);
	});

	it("handles a mixed file and supports an annotation-coverage report", () => {
		const file = writeTsFile(
			"mixed.ts",
			`
/**
 * Public, annotated.
 * @ai-tag core
 */
export function annotated(): void {}

/** Public, no @ai-* tags. */
export function unannotated(): void {}

/**
 * Hidden from the surface.
 * @ai-surface private
 */
export const secret = 1;
`.trim(),
		);

		const { exports } = extractor.extractFile(file);
		expect(exports).toHaveLength(3);

		// Annotation-coverage report: fraction of symbols carrying any @ai-* override.
		const annotatedCount = exports.filter(
			(s) => s.surface === "private" || s.tags.length > 0,
		).length;
		expect(annotatedCount).toBe(2);

		const byName = new Map(exports.map((s) => [s.name, s]));
		expect(byName.get("annotated")?.tags).toEqual(["core"]);
		expect(byName.get("unannotated")?.surface).toBe("public");
		expect(byName.get("unannotated")?.tags).toEqual([]);
		expect(byName.get("secret")?.surface).toBe("private");
	});
});
