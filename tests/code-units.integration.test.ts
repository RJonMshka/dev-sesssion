/**
 * Code-unit extraction over this repository's own source (REQ-UNIT-1..4).
 *
 * The unit tests use tidy synthetic files. This runs the extractor over real,
 * hand-maintained code — `as const` object APIs, overloads, JSDoc in every
 * position — and checks the contract on every unit it finds. The hash is
 * recomputed independently from the PROTOCOL.md definition.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../packages/core/src/annotation/ai-index-builder.js";
import { AutoExtractor } from "../packages/core/src/annotation/auto-extractor.js";
import type { ParsedFile } from "../packages/core/src/annotation/types.js";
import { UnitFocusResolver } from "../packages/core/src/calculators/unit-focus.js";
import type { ValidatedPath } from "../packages/security/src/validators/path-validator.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE_SRC = path.join(REPO_ROOT, "packages", "core", "src");

/** Lists non-test TypeScript sources under a directory. */
function sources(dir: string): string[] {
	const out: string[] = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name !== "__tests__") out.push(...sources(p));
		} else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
			out.push(p);
		}
	}
	return out;
}

const extractor = new AutoExtractor();
const parsed: { file: ParsedFile; source: string }[] = sources(CORE_SRC).map((p) => ({
	file: extractor.extractFile(p as ValidatedPath),
	source: fs.readFileSync(p, "utf-8"),
}));

describe("code units over packages/core/src", () => {
	it("finds units in every source file that declares anything (REQ-UNIT-1)", () => {
		expect(parsed.length).toBeGreaterThan(40);
		const total = parsed.reduce((n, p) => n + p.file.units.length, 0);
		// Measured at 2026-10-18: ~8 per file. A collapse means the walker broke.
		expect(total / parsed.length).toBeGreaterThan(4);
		// Every export the index already knew about is also a unit.
		for (const { file } of parsed) {
			const ids = new Set(file.units.map((u) => u.id.replace(/~\d+$/, "")));
			for (const sym of file.exports) {
				expect(ids, `${path.basename(file.path)}: ${sym.name}`).toContain(sym.name);
			}
		}
	});

	it("gives every unit a range whose text names it (REQ-UNIT-2)", () => {
		for (const { file, source } of parsed) {
			const lines = source.split("\n");
			for (const u of file.units) {
				expect(u.start).toBeGreaterThanOrEqual(1);
				expect(u.end).toBeGreaterThanOrEqual(u.start);
				expect(u.end).toBeLessThanOrEqual(lines.length);
				const leaf = u.id.replace(/~\d+$/, "").split(".").pop() ?? "";
				const text = lines.slice(u.start - 1, u.end).join("\n");
				if (leaf !== "default") {
					expect(text, `${path.basename(file.path)}#${u.id}`).toContain(leaf);
				}
			}
		}
	});

	it("never overlaps two top-level units (REQ-UNIT-2)", () => {
		for (const { file } of parsed) {
			const top = file.units.filter((u) => u.kind !== "method");
			for (let i = 1; i < top.length; i++) {
				const prev = top[i - 1];
				const cur = top[i];
				if (prev === undefined || cur === undefined) continue;
				expect(cur.start, `${path.basename(file.path)}#${cur.id}`).toBeGreaterThan(prev.end);
			}
		}
	});

	it("hashes every unit to the protocol definition (REQ-UNIT-3)", () => {
		for (const { file, source } of parsed) {
			const lines = source.split("\n");
			for (const u of file.units) {
				const text = lines.slice(u.start - 1, u.end).join("\n");
				const expected = createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
				expect(u.hash, `${path.basename(file.path)}#${u.id}`).toBe(expected);
			}
		}
	});

	it("keeps every id unique within its file (REQ-UNIT-4)", () => {
		for (const { file } of parsed) {
			const ids = file.units.map((u) => u.id);
			expect(new Set(ids).size, path.basename(file.path)).toBe(ids.length);
		}
	});
});

describe("disambiguation over packages/core/src (REQ-UNIT-30, REQ-UNIT-31)", () => {
	const index = AiIndexBuilder.build(
		parsed.map((p) => p.file),
		CORE_SRC,
	);

	it("proves both trimToMaxLines declarations are used, and focuses both", () => {
		// formatter-utils.ts exports the shared one; next-prompt-writer.ts keeps a
		// private copy it calls itself, importing the shared one as `trimLines`.
		const result = UnitFocusResolver.resolve({
			tasks: [{ text: "trimToMaxLines must keep the Focus line", status: "todo" }],
			index,
		});
		const byRef = new Map(result.focused.map((u) => [u.ref, u.evidence]));
		expect([...byRef.keys()].sort()).toEqual([
			"formatters/formatter-utils.ts#trimToMaxLines",
			"managers/next-prompt-writer.ts#trimToMaxLines",
		]);
		expect(byRef.get("formatters/formatter-utils.ts#trimToMaxLines")).toMatch(
			/^imported by \d+ files$/,
		);
		expect(byRef.get("managers/next-prompt-writer.ts#trimToMaxLines")).toBe(
			"referenced 1× in its file",
		);
		expect(result.ambiguous).toEqual([]);
	});

	it("records the renamed import that proves the shared one", () => {
		const imports = index.files["managers/next-prompt-writer.ts"]?.imports ?? [];
		expect(imports).toContainEqual({
			from: "formatters/formatter-utils.ts",
			name: "trimToMaxLines",
			local: "trimLines",
		});
	});

	it("never records an import outside the project root", () => {
		for (const entry of Object.values(index.files)) {
			for (const i of entry.imports ?? []) {
				expect(i.from.startsWith("/") || i.from.startsWith("..")).toBe(false);
			}
		}
	});
});
