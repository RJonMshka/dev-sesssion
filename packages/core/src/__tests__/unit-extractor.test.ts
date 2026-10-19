/**
 * Code-unit extraction (LLD-code-units.md, REQ-UNIT-1..4).
 *
 * Every assertion runs against what `AutoExtractor.extractFile` actually emits
 * for a real file on disk; the hash is recomputed here independently from the
 * PROTOCOL.md contract rather than by calling the implementation's helper.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { ParsedUnit } from "../annotation/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unit-extractor-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Writes a source file and returns its path. */
function write(filename: string, content: string): ValidatedPath {
	const p = path.join(tmpDir, filename);
	fs.writeFileSync(p, content, "utf-8");
	return p as ValidatedPath;
}

/** The PROTOCOL.md hash contract, implemented independently. */
function protocolHash(source: string, start: number, end: number): string {
	const text = source
		.split("\n")
		.slice(start - 1, end)
		.join("\n");
	return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/** Units keyed by id. */
function byId(units: readonly ParsedUnit[]): Map<string, ParsedUnit> {
	return new Map(units.map((u) => [u.id, u]));
}

const extractor = new AutoExtractor();

const MIXED = `import { z } from "zod";

/** Parses a body. */
export function parseBody(input: string): string {
  return helper(input);
}

function helper(s: string): string {
  return s.trim();
}

export class Store {
  private items: string[] = [];

  /** Adds one. */
  add(item: string): void {
    this.items.push(item);
  }

  get size(): number {
    return this.items.length;
  }
}

export const Manager = {
  load(): void {},
  save: (): void => {},
  name: "m",
} as const;

export type Id = string;

interface Shape {
  id: Id;
}

enum Color {
  Red,
}

export { helper };
`;

describe("unit extraction", () => {
	it("records every top-level declaration, exported or not (REQ-UNIT-1)", () => {
		const result = extractor.extractFile(write("mixed.ts", MIXED));
		const ids = result.units.map((u) => u.id);
		for (const id of ["parseBody", "helper", "Store", "Manager", "Id", "Shape", "Color"]) {
			expect(ids).toContain(id);
		}
		const units = byId(result.units);
		expect(units.get("parseBody")?.exported).toBe(true);
		// `export { helper }` at the bottom exports it (REQ-UNIT-34); this
		// assertion read `false` until that was fixed.
		expect(units.get("helper")?.exported).toBe(true);
		expect(units.get("Shape")?.exported).toBe(false);
		expect(units.get("Shape")?.kind).toBe("interface");
		expect(units.get("Color")?.kind).toBe("enum");
		expect(units.get("Id")?.kind).toBe("type");
		expect(units.get("Manager")?.kind).toBe("variable");
	});

	it("records methods of top-level classes and object literals (REQ-UNIT-1)", () => {
		const result = extractor.extractFile(write("mixed.ts", MIXED));
		const units = byId(result.units);
		expect(units.get("Store.add")?.kind).toBe("method");
		expect(units.get("Store.size")?.kind).toBe("method");
		// `as const` wraps the object literal; its function-valued members are units.
		expect(units.get("Manager.load")?.kind).toBe("method");
		expect(units.get("Manager.save")?.kind).toBe("method");
		// A non-function property is not a unit.
		expect(units.has("Manager.name")).toBe(false);
		// A class field is not a unit.
		expect(units.has("Store.items")).toBe(false);
		// `export { helper }` re-exports; it must not add a second unit.
		expect(result.units.filter((u) => u.id.startsWith("helper"))).toHaveLength(1);
	});

	it("starts a unit at its attached JSDoc and ends at its last line (REQ-UNIT-2)", () => {
		const result = extractor.extractFile(write("mixed.ts", MIXED));
		const lines = MIXED.split("\n");
		const parseBody = byId(result.units).get("parseBody");
		expect(parseBody).toBeDefined();
		expect(lines[(parseBody?.start ?? 0) - 1]).toBe("/** Parses a body. */");
		expect(lines[(parseBody?.end ?? 0) - 1]).toBe("}");
		expect(parseBody?.end).toBe(6);

		const add = byId(result.units).get("Store.add");
		expect(lines[(add?.start ?? 0) - 1]?.trim()).toBe("/** Adds one. */");
		expect(lines[(add?.end ?? 0) - 1]?.trim()).toBe("}");

		// No JSDoc: starts at the declaration itself.
		const helper = byId(result.units).get("helper");
		expect(lines[(helper?.start ?? 0) - 1]).toBe("function helper(s: string): string {");
	});

	it("does not attach a JSDoc separated from the declaration by code (REQ-UNIT-2)", () => {
		const src = `/** About x. */\nconst x = 1;\nfunction y(): void {}\n`;
		const result = extractor.extractFile(write("gap.ts", src));
		expect(byId(result.units).get("y")?.start).toBe(3);
		expect(byId(result.units).get("x")?.start).toBe(1);
	});

	it("hashes exactly the lines of the range (REQ-UNIT-3)", () => {
		const result = extractor.extractFile(write("mixed.ts", MIXED));
		expect(result.units.length).toBeGreaterThan(0);
		for (const u of result.units) {
			expect(u.hash).toMatch(/^[0-9a-f]{16}$/);
			expect(u.hash).toBe(protocolHash(MIXED, u.start, u.end));
		}
		expect(result.hash).toBe(createHash("sha256").update(MIXED).digest("hex").slice(0, 16));
	});

	it("changes a unit's hash only when its own lines change (REQ-UNIT-3)", () => {
		const before = byId(extractor.extractFile(write("a.ts", MIXED)).units);
		const edited = MIXED.replace("return s.trim();", "return s.trim().toLowerCase();");
		const after = byId(extractor.extractFile(write("a.ts", edited)).units);
		expect(after.get("helper")?.hash).not.toBe(before.get("helper")?.hash);
		expect(after.get("parseBody")?.hash).toBe(before.get("parseBody")?.hash);
	});

	it("gives overloads and repeated names unique ids (REQ-UNIT-4)", () => {
		const src = [
			"export function pick(a: string): string;",
			"export function pick(a: number): number;",
			"export function pick(a: unknown): unknown {",
			"  return a;",
			"}",
			"interface Box { a: string }",
			"interface Box { b: string }",
			"",
		].join("\n");
		const ids = extractor.extractFile(write("dupes.ts", src)).units.map((u) => u.id);
		expect(ids).toEqual(["pick", "pick~2", "pick~3", "Box", "Box~2"]);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("names an anonymous default export `default` (REQ-UNIT-4)", () => {
		const src = "export default function (): number {\n  return 1;\n}\n";
		const units = extractor.extractFile(write("def.ts", src)).units;
		expect(units.map((u) => u.id)).toEqual(["default"]);
		expect(units[0]?.exported).toBe(true);
	});

	it("reports a token cost for each unit", () => {
		const units = extractor.extractFile(write("mixed.ts", MIXED)).units;
		for (const u of units) {
			expect(u.tokens).toBeGreaterThan(0);
		}
	});

	it("returns no units for an unparseable file", () => {
		const result = extractor.extractFile(write("broken.ts", "export function (\n"));
		expect(result.units).toEqual([]);
	});
});
