/**
 * Adversarial tests for ContentSanitizer.
 *
 * Tests prototype pollution key stripping, deeply nested pollution,
 * strict mode enforcement, and safe handling of edge cases.
 */
import { describe, expect, it } from "vitest";
import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";
import { ContentSanitizer } from "../sanitizers/content-sanitizer.js";

describe("ContentSanitizer — adversarial tests", () => {
	describe("prototype pollution — __proto__", () => {
		it("strips __proto__ from top-level object", () => {
			const dirty = JSON.parse('{"__proto__": {"isAdmin": true}, "name": "test"}');
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			expect(clean).not.toHaveProperty("__proto__");
			expect(clean).toHaveProperty("name", "test");
		});

		it("strips __proto__ from nested object", () => {
			const dirty = { user: { __proto__: { admin: true }, name: "bob" } };
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			const user = clean.user as Record<string, unknown>;
			expect(Object.keys(user)).not.toContain("__proto__");
			expect(user.name).toBe("bob");
		});

		it("strips __proto__ deeply nested (3+ levels)", () => {
			const dirty = {
				a: { b: { c: { __proto__: { pwned: true }, legit: "ok" } } },
			};
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			const c = ((clean.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<
				string,
				unknown
			>;
			expect(Object.keys(c)).toEqual(["legit"]);
		});
	});

	describe("prototype pollution — constructor", () => {
		it("strips constructor key", () => {
			const dirty = { constructor: { prototype: { isAdmin: true } } };
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			expect(Object.keys(clean)).toEqual([]);
		});
	});

	describe("prototype pollution — prototype", () => {
		it("strips prototype key", () => {
			const dirty = { prototype: { isAdmin: true }, name: "safe" };
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			expect(Object.keys(clean)).toEqual(["name"]);
		});
	});

	describe("combined pollution keys", () => {
		it("strips all three pollution keys in same object", () => {
			const dirty = {
				__proto__: {},
				constructor: {},
				prototype: {},
				safe: "value",
			};
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			expect(Object.keys(clean)).toEqual(["safe"]);
		});
	});

	describe("strict mode", () => {
		it("throws SecurityError for __proto__ in strict mode", () => {
			// Must use JSON.parse — JS object literals absorb __proto__ into the prototype chain
			const dirty = JSON.parse('{"__proto__": {"admin": true}}');
			expect(() => ContentSanitizer.sanitize(dirty, { strict: true })).toThrow(SecurityError);
		});

		it("throws with PROTOTYPE_POLLUTION threat", () => {
			const dirty = JSON.parse('{"constructor": {}}');
			try {
				ContentSanitizer.sanitize(dirty, { strict: true });
				expect.fail("Expected SecurityError");
			} catch (error) {
				expect(error).toBeInstanceOf(SecurityError);
				if (error instanceof SecurityError) {
					expect(error.threat).toBe(SecurityThreat.PROTOTYPE_POLLUTION);
				}
			}
		});

		it("throws for nested pollution key in strict mode", () => {
			// Must use JSON.parse to preserve __proto__ as an actual key
			const dirty = JSON.parse('{"a": {"__proto__": {}}}');
			expect(() => ContentSanitizer.sanitize(dirty, { strict: true })).toThrow(SecurityError);
		});

		it("does not throw for clean objects in strict mode", () => {
			const clean = { name: "safe", count: 42 };
			expect(() => ContentSanitizer.sanitize(clean, { strict: true })).not.toThrow();
		});
	});

	describe("hasPollutionKeys detection", () => {
		it("detects __proto__", () => {
			// Must use JSON.parse — JS object literals absorb __proto__ into prototype chain
			expect(ContentSanitizer.hasPollutionKeys(JSON.parse('{"__proto__": {}}'))).toBe(true);
		});

		it("detects constructor", () => {
			expect(ContentSanitizer.hasPollutionKeys(JSON.parse('{"constructor": {}}'))).toBe(true);
		});

		it("detects prototype", () => {
			expect(ContentSanitizer.hasPollutionKeys(JSON.parse('{"prototype": {}}'))).toBe(true);
		});

		it("detects nested pollution", () => {
			expect(ContentSanitizer.hasPollutionKeys(JSON.parse('{"a": {"__proto__": {}}}'))).toBe(true);
		});

		it("detects pollution in arrays", () => {
			expect(ContentSanitizer.hasPollutionKeys(JSON.parse('[{"__proto__": {}}]'))).toBe(true);
		});

		it("returns false for clean objects", () => {
			expect(ContentSanitizer.hasPollutionKeys({ name: "safe" })).toBe(false);
		});

		it("returns false for primitives", () => {
			expect(ContentSanitizer.hasPollutionKeys(42)).toBe(false);
			expect(ContentSanitizer.hasPollutionKeys("string")).toBe(false);
			expect(ContentSanitizer.hasPollutionKeys(null)).toBe(false);
			expect(ContentSanitizer.hasPollutionKeys(undefined)).toBe(false);
		});
	});

	describe("null-prototype output", () => {
		it("returns Object.create(null) objects (no inherited properties)", () => {
			const dirty = { name: "test" };
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			// Object.create(null) has no prototype
			expect(Object.getPrototypeOf(clean)).toBe(null);
		});

		it("nested objects also have null prototype", () => {
			const dirty = { nested: { value: 1 } };
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			const nested = clean.nested as Record<string, unknown>;
			expect(Object.getPrototypeOf(nested)).toBe(null);
		});
	});

	describe("edge cases", () => {
		it("preserves arrays", () => {
			const dirty = { items: [1, 2, 3] };
			const clean = ContentSanitizer.sanitize(dirty) as Record<string, unknown>;
			expect(clean.items).toEqual([1, 2, 3]);
		});

		it("preserves primitives in arrays", () => {
			const result = ContentSanitizer.sanitize([1, "two", true, null]);
			expect(result).toEqual([1, "two", true, null]);
		});

		it("sanitizes objects inside arrays", () => {
			const dirty = [{ __proto__: {}, name: "ok" }];
			const result = ContentSanitizer.sanitize(dirty) as unknown[];
			const first = result[0] as Record<string, unknown>;
			expect(Object.keys(first)).toEqual(["name"]);
		});

		it("returns primitive values unchanged", () => {
			expect(ContentSanitizer.sanitize(42)).toBe(42);
			expect(ContentSanitizer.sanitize("hello")).toBe("hello");
			expect(ContentSanitizer.sanitize(true)).toBe(true);
			expect(ContentSanitizer.sanitize(null)).toBe(null);
			expect(ContentSanitizer.sanitize(undefined)).toBe(undefined);
		});

		it("handles empty object", () => {
			const result = ContentSanitizer.sanitize({}) as Record<string, unknown>;
			expect(Object.keys(result)).toEqual([]);
		});

		it("handles empty array", () => {
			expect(ContentSanitizer.sanitize([])).toEqual([]);
		});
	});
});
