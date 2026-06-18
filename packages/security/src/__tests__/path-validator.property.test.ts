/**
 * Property-based tests for PathValidator (fast-check).
 *
 * These complement the example-based adversarial suite by asserting the
 * INVARIANTS that must hold across the entire input space, not just the
 * hand-picked attack strings. The central security property:
 *
 *   For ANY string input, safeResolvePath either throws a SecurityError or
 *   returns a path that is provably inside the project root. It must never
 *   silently return a path that escapes the boundary.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";
import { PathValidator } from "../validators/path-validator.js";

/** Number of generated cases per property. */
const RUNS = 500;

/** Path segments that are dangerous prototype-pollution keys. */
const DANGEROUS_SEGMENTS = ["__proto__", "constructor", "prototype"];

describe("PathValidator — property-based tests", () => {
	let projectRoot: string;

	beforeEach(() => {
		// Resolve /tmp -> /private/tmp on macOS so boundary checks line up.
		projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pathval-prop-")));
	});

	afterEach(() => {
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});

	/**
	 * Asserts the resolve outcome is safe: either a SecurityError was thrown,
	 * or the returned path is exactly the root or sits under `root + sep`.
	 */
	function expectSafe(input: string): void {
		let result: string | undefined;
		try {
			result = PathValidator.safeResolvePath(input, projectRoot);
		} catch (error) {
			expect(error).toBeInstanceOf(SecurityError);
			return;
		}
		const rootWithSep = projectRoot + path.sep;
		const inside = result === projectRoot || result.startsWith(rootWithSep);
		expect(inside).toBe(true);
	}

	describe("core safety invariant", () => {
		it("never returns a path outside the root, for arbitrary unicode strings", () => {
			fc.assert(
				fc.property(fc.string(), (input) => {
					expectSafe(input);
				}),
				{ numRuns: RUNS },
			);
		});

		it("never returns a path outside the root, for arbitrary raw code units", () => {
			fc.assert(
				fc.property(fc.string({ unit: "binary" }), (input) => {
					expectSafe(input);
				}),
				{ numRuns: RUNS },
			);
		});

		it("never escapes when fuzzing path-like fragments joined by separators", () => {
			const fragment = fc.constantFrom("..", ".", "a", "b", "src", "", "...", "....", "~", "foo");
			fc.assert(
				fc.property(
					fc.array(fragment, { minLength: 1, maxLength: 12 }),
					fc.constantFrom("/", "\\", path.sep),
					(parts, sep) => {
						expectSafe(parts.join(sep));
					},
				),
				{ numRuns: RUNS },
			);
		});
	});

	describe("determinism", () => {
		it("produces the same outcome (value or throw) for the same input", () => {
			fc.assert(
				fc.property(fc.string(), (input) => {
					const run = (): { ok: true; value: string } | { ok: false } => {
						try {
							return { ok: true, value: PathValidator.safeResolvePath(input, projectRoot) };
						} catch {
							return { ok: false };
						}
					};
					const a = run();
					const b = run();
					expect(a.ok).toBe(b.ok);
					if (a.ok && b.ok) {
						expect(a.value).toBe(b.value);
					}
				}),
				{ numRuns: RUNS },
			);
		});
	});

	describe("valid relative paths are accepted and resolve correctly", () => {
		// Segments that are safe: non-empty, no separators, no null bytes, not
		// "." / ".." and not a dangerous prototype key.
		const safeSegment = fc
			.string({ minLength: 1, maxLength: 20 })
			.filter(
				(s) =>
					!s.includes("/") &&
					!s.includes("\\") &&
					!s.includes("\0") &&
					s !== "." &&
					s !== ".." &&
					!DANGEROUS_SEGMENTS.includes(s),
			);

		it("accepts any join of safe segments and equals path.resolve(root, joined)", () => {
			fc.assert(
				fc.property(fc.array(safeSegment, { minLength: 1, maxLength: 8 }), (segments) => {
					const rel = segments.join("/");
					const result = PathValidator.safeResolvePath(rel, projectRoot);
					expect(result).toBe(path.resolve(projectRoot, rel));
					expect(result.startsWith(projectRoot + path.sep)).toBe(true);
				}),
				{ numRuns: RUNS },
			);
		});
	});

	describe("inputs that must always be rejected", () => {
		it("rejects any string containing a null byte", () => {
			fc.assert(
				fc.property(fc.string(), fc.string(), (prefix, suffix) => {
					const input = `${prefix}\0${suffix}`;
					expect(() => PathValidator.safeResolvePath(input, projectRoot)).toThrow(SecurityError);
				}),
				{ numRuns: RUNS },
			);
		});

		it("rejects any absolute POSIX path", () => {
			const safeSegment = fc
				.string({ minLength: 1, maxLength: 12 })
				.filter((s) => !s.includes("/") && !s.includes("\0"));
			fc.assert(
				fc.property(fc.array(safeSegment, { minLength: 1, maxLength: 6 }), (segments) => {
					const abs = `/${segments.join("/")}`;
					expect(() => PathValidator.safeResolvePath(abs, projectRoot)).toThrow(SecurityError);
				}),
				{ numRuns: RUNS },
			);
		});

		it("rejects any path whose segments include a prototype-pollution key", () => {
			const plainSegment = fc
				.string({ minLength: 1, maxLength: 8 })
				.filter((s) => !s.includes(path.sep) && !s.includes("\0"));
			fc.assert(
				fc.property(
					fc.array(plainSegment, { maxLength: 4 }),
					fc.constantFrom(...DANGEROUS_SEGMENTS),
					fc.array(plainSegment, { maxLength: 4 }),
					(before, danger, after) => {
						const input = [...before, danger, ...after].join(path.sep);
						expect(() => PathValidator.safeResolvePath(input, projectRoot)).toThrow(SecurityError);
					},
				),
				{ numRuns: RUNS },
			);
		});

		it("rejects traversal that climbs above the root via leading ../ runs", () => {
			const safeSegment = fc
				.string({ minLength: 1, maxLength: 8 })
				.filter((s) => !s.includes("/") && !s.includes("\0") && s !== "." && s !== "..");
			fc.assert(
				fc.property(
					fc.integer({ min: 1, max: 10 }),
					fc.array(safeSegment, { maxLength: 4 }),
					(ups, tail) => {
						// N leading "../" guarantees the resolved path is above the
						// freshly-created temp root (which has > 0 but bounded depth,
						// and 1..10 levels up always clears a /private/tmp/xxx root's
						// own contribution). Build enough to be certain.
						const climb = "../".repeat(ups + 20);
						const input = climb + tail.join("/");
						expect(() => PathValidator.safeResolvePath(input, projectRoot)).toThrow(SecurityError);
					},
				),
				{ numRuns: RUNS },
			);
		});

		it("rejected throws always carry the PATH_TRAVERSAL threat", () => {
			fc.assert(
				fc.property(fc.string(), (input) => {
					try {
						PathValidator.safeResolvePath(input, projectRoot);
					} catch (error) {
						expect(error).toBeInstanceOf(SecurityError);
						if (error instanceof SecurityError) {
							expect(error.threat).toBe(SecurityThreat.PATH_TRAVERSAL);
						}
					}
				}),
				{ numRuns: RUNS },
			);
		});
	});
});
