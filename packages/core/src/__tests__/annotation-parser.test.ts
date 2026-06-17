/**
 * Unit and adversarial tests for AnnotationParser.
 *
 * Adversarial coverage (required for this security-sensitive parser):
 * - YAML injection via annotation values
 * - Malformed values (out-of-range, wrong type, garbage)
 * - Unknown `@ai-*` tags ignored safely
 * - Prototype-pollution keys in tag values and symbol names
 */

import { describe, expect, it } from "vitest";
import { AnnotationParser } from "../annotation/annotation-parser.js";

const parser = new AnnotationParser();

/** Build a JSDoc-style comment body (as estree exposes it) from raw lines. */
function block(...lines: string[]): string {
	return ["*", ...lines.map((l) => ` * ${l}`)].join("\n");
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("AnnotationParser.parse — valid tags", () => {
	it("returns empty annotations for an empty block", () => {
		const ann = parser.parse("");
		expect(ann.tags).toEqual([]);
		expect(ann.surface).toBeUndefined();
		expect(ann.summary).toBeUndefined();
		expect(ann.layerHint).toBeUndefined();
	});

	it("returns empty annotations for a block with no @ai-* tags", () => {
		const ann = parser.parse(block("Just a normal summary.", "@param a - first"));
		expect(ann.tags).toEqual([]);
		expect(ann.surface).toBeUndefined();
		expect(ann.summary).toBeUndefined();
	});

	it("parses @ai-surface public and private", () => {
		expect(parser.parse(block("@ai-surface public")).surface).toBe("public");
		expect(parser.parse(block("@ai-surface private")).surface).toBe("private");
	});

	it("is case-insensitive on the surface value", () => {
		expect(parser.parse(block("@ai-surface PRIVATE")).surface).toBe("private");
	});

	it("parses @ai-summary and collapses whitespace", () => {
		const ann = parser.parse(block("@ai-summary   Builds   the   index."));
		expect(ann.summary).toBe("Builds the index.");
	});

	it("parses @ai-layer-hint and its @ai-layer-default alias", () => {
		expect(parser.parse(block("@ai-layer-hint 0")).layerHint).toBe(0);
		expect(parser.parse(block("@ai-layer-hint 2")).layerHint).toBe(2);
		expect(parser.parse(block("@ai-layer-default 1")).layerHint).toBe(1);
	});

	it("parses repeated @ai-tag into a sorted, de-duplicated list", () => {
		const ann = parser.parse(
			block("@ai-tag zeta", "@ai-tag alpha", "@ai-tag alpha", "@ai-tag mid-tier"),
		);
		expect(ann.tags).toEqual(["alpha", "mid-tier", "zeta"]);
	});

	it("parses a mixed block with all tag kinds", () => {
		const ann = parser.parse(
			block(
				"Auto summary that gets overridden.",
				"@ai-surface private",
				"@ai-summary Real summary.",
				"@ai-layer-hint 2",
				"@ai-tag experimental",
			),
		);
		expect(ann).toEqual({
			surface: "private",
			summary: "Real summary.",
			layerHint: 2,
			tags: ["experimental"],
		});
	});

	it("takes the first well-formed value when a tag is repeated", () => {
		const ann = parser.parse(block("@ai-surface private", "@ai-surface public"));
		expect(ann.surface).toBe("private");
	});

	it("parses tags even without the leading ' * ' gutter", () => {
		const ann = parser.parse("@ai-surface private\n@ai-tag bare");
		expect(ann.surface).toBe("private");
		expect(ann.tags).toEqual(["bare"]);
	});
});

// ---------------------------------------------------------------------------
// Malformed values — silently ignored, never thrown
// ---------------------------------------------------------------------------

describe("AnnotationParser.parse — malformed values", () => {
	it("ignores an out-of-allowlist surface", () => {
		expect(parser.parse(block("@ai-surface internal")).surface).toBeUndefined();
		expect(parser.parse(block("@ai-surface")).surface).toBeUndefined();
	});

	it("ignores out-of-range or non-numeric layer hints", () => {
		expect(parser.parse(block("@ai-layer-hint 3")).layerHint).toBeUndefined();
		expect(parser.parse(block("@ai-layer-hint -1")).layerHint).toBeUndefined();
		expect(parser.parse(block("@ai-layer-hint two")).layerHint).toBeUndefined();
		expect(parser.parse(block("@ai-layer-hint 1.5")).layerHint).toBeUndefined();
	});

	it("ignores an empty summary", () => {
		expect(parser.parse(block("@ai-summary    ")).summary).toBeUndefined();
	});

	it("ignores unknown @ai-* tags without throwing", () => {
		const ann = parser.parse(block("@ai-deps foo,bar", "@ai-context-cost 99", "@ai-bogus x"));
		expect(ann.tags).toEqual([]);
		expect(ann.surface).toBeUndefined();
	});

	it("never throws on arbitrary garbage input", () => {
		for (const junk of ["@ai-", "@ai-@@@", "@@@@", "@ai-surface\t\t", "   ", "\n\n\n"]) {
			expect(() => parser.parse(junk)).not.toThrow();
		}
	});
});

// ---------------------------------------------------------------------------
// Adversarial: YAML injection
// ---------------------------------------------------------------------------

describe("AnnotationParser.parse — YAML injection defense", () => {
	it("keeps a YAML-metacharacter summary as a single literal line", () => {
		const ann = parser.parse(block("@ai-summary Returns {ok: true} or fails: see [docs]"));
		expect(ann.summary).toBe("Returns {ok: true} or fails: see [docs]");
		// No newline can be smuggled in — the value is a single line.
		expect(ann.summary).not.toContain("\n");
	});

	it("cannot extend a summary across a newline (injection truncates)", () => {
		// A literal newline ends the directive line; the injected key is not parsed.
		const ann = parser.parse("@ai-summary safe\ninjected_key: evil");
		expect(ann.summary).toBe("safe");
	});

	it("strips control characters from a summary", () => {
		const ann = parser.parse("@ai-summary a\u0009b\u0007c\u0000d");
		expect(ann.summary).toBe("a b c d");
		const hasControlChar = [...(ann.summary ?? "")].some((ch) => {
			const code = ch.charCodeAt(0);
			return code < 0x20 || code === 0x7f;
		});
		expect(hasControlChar).toBe(false);
	});

	it("rejects tags containing YAML metacharacters", () => {
		const ann = parser.parse(
			block("@ai-tag foo: bar", "@ai-tag {evil}", '@ai-tag "quoted"', "@ai-tag a,b"),
		);
		expect(ann.tags).toEqual([]);
	});

	it("caps an over-long summary at 200 characters", () => {
		const ann = parser.parse(block(`@ai-summary ${"x".repeat(500)}`));
		expect(ann.summary).toHaveLength(200);
	});

	it("drops an over-long tag slug (>40 chars)", () => {
		const ann = parser.parse(block(`@ai-tag ${"a".repeat(50)}`));
		expect(ann.tags).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Adversarial: prototype pollution
// ---------------------------------------------------------------------------

describe("AnnotationParser — prototype pollution defense", () => {
	it("drops prototype-pollution keys used as tag values", () => {
		const ann = parser.parse(
			block("@ai-tag __proto__", "@ai-tag constructor", "@ai-tag prototype", "@ai-tag legit"),
		);
		expect(ann.tags).toEqual(["legit"]);
	});

	it("collect() never pollutes Object.prototype via malicious symbol names", () => {
		const result = parser.collect("", [
			["__proto__", "@ai-tag x"],
			["constructor", "@ai-surface private"],
			["prototype", "@ai-tag y"],
			["safeSymbol", "@ai-tag ok"],
		]);

		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(Object.hasOwn(result.symbols, "__proto__")).toBe(false);
		expect(result.symbols.safeSymbol?.tags).toEqual(["ok"]);
	});

	it("collect() builds a null-prototype symbols map", () => {
		const result = parser.collect("", [["a", "@ai-tag x"]]);
		expect(Object.getPrototypeOf(result.symbols)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("AnnotationParser.parse — determinism", () => {
	it("produces identical output across repeated parses (stable serialization)", () => {
		const input = block("@ai-tag z", "@ai-tag a", "@ai-surface private", "@ai-summary Hi.");
		const first = JSON.stringify(parser.parse(input));
		const second = JSON.stringify(parser.parse(input));
		expect(first).toBe(second);
	});
});
