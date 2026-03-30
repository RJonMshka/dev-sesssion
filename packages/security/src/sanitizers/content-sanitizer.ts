import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";

/**
 * Keys that indicate prototype pollution attempts.
 * These keys must be stripped from any object built from untrusted parsed data.
 */
const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Options for {@link ContentSanitizer.sanitize}.
 */
export interface SanitizeOptions {
	/**
	 * When `true`, throw a {@link SecurityError} instead of silently stripping
	 * dangerous keys. Defaults to `false` (strip mode).
	 */
	readonly strict?: boolean | undefined;
}

/**
 * Sanitizes parsed objects by removing prototype pollution keys.
 *
 * Any object built from untrusted data (YAML frontmatter, JSON configs, etc.)
 * should pass through this sanitizer before use.
 */
export const ContentSanitizer = {
	/**
	 * Recursively removes prototype pollution keys from a parsed object.
	 *
	 * Returns a new object created with `Object.create(null)` to prevent
	 * any prototype chain access. Arrays are deeply sanitized but remain arrays.
	 * Primitive values are returned as-is.
	 *
	 * @param input - The untrusted parsed data to sanitize.
	 * @param options - Optional configuration. Set `strict: true` to throw on pollution keys.
	 * @returns A sanitized deep copy of the input with no prototype pollution keys.
	 * @throws {SecurityError} With `PROTOTYPE_POLLUTION` threat if `strict` is `true` and a pollution key is found.
	 *
	 * @example
	 * ```ts
	 * const dirty = JSON.parse(untrustedJson);
	 * const clean = ContentSanitizer.sanitize(dirty);
	 * ```
	 */
	sanitize(input: unknown, options?: SanitizeOptions): unknown {
		return sanitizeValue(input, options?.strict === true);
	},

	/**
	 * Checks whether an object contains any prototype pollution keys at any depth.
	 *
	 * @param input - The value to inspect.
	 * @returns `true` if pollution keys were found, `false` otherwise.
	 */
	hasPollutionKeys(input: unknown): boolean {
		return detectPollutionKeys(input);
	},
} as const;

/**
 * Recursively sanitizes a value, stripping or rejecting prototype pollution keys.
 *
 * @param value - The value to sanitize.
 * @param strict - Whether to throw on pollution keys.
 * @returns The sanitized value.
 */
function sanitizeValue(value: unknown, strict: boolean): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	if (Array.isArray(value)) {
		return sanitizeArray(value, strict);
	}

	if (typeof value === "object") {
		return sanitizeObject(value as Record<string, unknown>, strict);
	}

	// Primitives pass through unchanged
	return value;
}

/**
 * Sanitizes an array by deeply sanitizing each element.
 *
 * @param arr - The array to sanitize.
 * @param strict - Whether to throw on pollution keys.
 * @returns A new array with sanitized elements.
 */
function sanitizeArray(arr: readonly unknown[], strict: boolean): unknown[] {
	const result: unknown[] = [];
	for (const item of arr) {
		result.push(sanitizeValue(item, strict));
	}
	return result;
}

/**
 * Sanitizes a plain object by creating a null-prototype copy without pollution keys.
 *
 * @param obj - The object to sanitize.
 * @param strict - Whether to throw on pollution keys.
 * @returns A new null-prototype object with sanitized values.
 */
function sanitizeObject(obj: Record<string, unknown>, strict: boolean): Record<string, unknown> {
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

	for (const key of Object.keys(obj)) {
		if (POLLUTION_KEYS.has(key)) {
			if (strict) {
				throw new SecurityError({
					threat: SecurityThreat.PROTOTYPE_POLLUTION,
					message: `Object contains prototype pollution key "${key}"`,
				});
			}
			// In non-strict mode, silently skip the dangerous key
			continue;
		}

		result[key] = sanitizeValue(obj[key], strict);
	}

	return result;
}

/**
 * Recursively checks whether a value contains any prototype pollution keys.
 *
 * @param value - The value to inspect.
 * @returns `true` if any pollution key is found at any depth.
 */
function detectPollutionKeys(value: unknown): boolean {
	if (value === null || value === undefined) {
		return false;
	}

	if (Array.isArray(value)) {
		return value.some((item) => detectPollutionKeys(item));
	}

	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		for (const key of Object.keys(obj)) {
			if (POLLUTION_KEYS.has(key)) {
				return true;
			}
			if (detectPollutionKeys(obj[key])) {
				return true;
			}
		}
	}

	return false;
}
