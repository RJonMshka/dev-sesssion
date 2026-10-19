/**
 * Code units in the ai-index — persistence (REQ-UNIT-5, REQ-UNIT-6).
 *
 * The index is built from real extractor output, not hand-written entries, so
 * the ids that reach the YAML writer are the awkward ones the extractor really
 * produces: `Parent.member`, `name~2`, `#private`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-index-units-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const SOURCE = `export class Store {
  #secret(): void {}
  "quoted-name"(): void {}
  add(): void {}
}
export function pick(a: string): string;
export function pick(a: unknown): unknown {
  return a;
}
export const Api = {
  load(): void {},
} as const;
`;

/** Extracts SOURCE from a real file and builds an index rooted at tmpDir. */
function buildIndex() {
	const file = path.join(tmpDir, "src", "store.ts");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, SOURCE, "utf-8");
	const parsed = new AutoExtractor().extractFile(file as ValidatedPath);
	return AiIndexBuilder.build([parsed], tmpDir);
}

describe("ai-index units", () => {
	it("stores every extracted unit and the file hash", () => {
		const index = buildIndex();
		const entry = index.files["src/store.ts"];
		expect(entry?.hash).toMatch(/^[0-9a-f]{16}$/);
		expect(Object.keys(entry?.units ?? {}).sort()).toEqual(
			[
				"Api",
				"Api.load",
				"Store",
				"Store.#secret",
				"Store.add",
				"Store.quoted-name",
				"pick",
				"pick~2",
			].sort(),
		);
	});

	it("round-trips units through serialize and deserialize (REQ-UNIT-5)", () => {
		const index = buildIndex();
		const back = AiIndexBuilder.deserialize(AiIndexBuilder.serialize(index));
		expect(back.files["src/store.ts"]?.units).toEqual(index.files["src/store.ts"]?.units);
		expect(back.files["src/store.ts"]?.hash).toBe(index.files["src/store.ts"]?.hash);
	});

	it("serializes deterministically (REQ-UNIT-5)", () => {
		const index = buildIndex();
		const once = AiIndexBuilder.serialize(index);
		const twice = AiIndexBuilder.serialize(AiIndexBuilder.deserialize(once));
		expect(twice).toBe(once);
	});

	it("loads an entry written before units existed (REQ-UNIT-6)", () => {
		const legacy = AiIndexBuilder.serialize(buildIndex())
			.split("\n")
			// Drop the units block and the file hash, as an older writer would have.
			.filter((line, i, all) => {
				const unitsAt = all.findIndex((l) => l.trim() === "units:");
				const blockEnd = all.findIndex(
					(l, j) => j > unitsAt && /^ {0,4}\S/.test(l) && !l.startsWith("      "),
				);
				const inUnits = unitsAt !== -1 && i >= unitsAt && (blockEnd === -1 || i < blockEnd);
				return !inUnits && !/^ {4}hash:/.test(line);
			})
			.join("\n");
		expect(legacy).not.toContain("units:");

		const back = AiIndexBuilder.deserialize(legacy);
		const entry = back.files["src/store.ts"];
		expect(entry).toBeDefined();
		expect(entry?.units).toBeUndefined();
		expect(entry?.hash).toBeUndefined();
		expect(Object.keys(entry?.exports ?? {})).toContain("Store");
	});

	it("drops a malformed unit row rather than inventing values", () => {
		const yaml = AiIndexBuilder.serialize(buildIndex()).replace(/( {8}start: )\d+/, '$1"oops"');
		const units = AiIndexBuilder.deserialize(yaml).files["src/store.ts"]?.units ?? {};
		expect(Object.keys(units)).toHaveLength(7);
	});
});
