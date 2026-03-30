import matter from "@11ty/gray-matter";
import type { z } from "zod";

import { ParseError } from "../errors/parse-error.js";
import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";
import { ContentSanitizer } from "../sanitizers/content-sanitizer.js";

/**
 * The result of parsing frontmatter from a string.
 *
 * @typeParam T - The validated shape of the frontmatter data, inferred from the Zod schema.
 */
export interface ParsedFrontmatter<T> {
	/** The validated and sanitized frontmatter data. */
	readonly data: T;
	/** The content body (everything after the closing `---` delimiter). */
	readonly content: string;
}

/**
 * Options for {@link FrontmatterParser.parse}.
 */
export interface FrontmatterParseOptions {
	/**
	 * A relative file path for error messages.
	 * Must not be an absolute path.
	 */
	readonly file: string;
}

/**
 * Safely parses YAML frontmatter from markdown strings.
 *
 * Wraps `@11ty/gray-matter` with the JavaScript engine disabled and applies:
 * 1. Prototype pollution sanitization via {@link ContentSanitizer}
 * 2. Zod schema validation with `.strict()` enforcement (caller should use `.strict()`)
 *
 * Never use `gray-matter` directly — always go through this parser.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * const schema = z.object({ title: z.string(), draft: z.boolean() }).strict();
 * const result = FrontmatterParser.parse(markdownString, schema, { file: "post.md" });
 * // result.data is { title: string, draft: boolean }
 * // result.content is the markdown body
 * ```
 */
export const FrontmatterParser = {
	/**
	 * Parses and validates frontmatter from a string.
	 *
	 * @typeParam T - The Zod output type, inferred from the schema.
	 * @param input - The raw markdown string containing YAML frontmatter.
	 * @param schema - A Zod schema to validate the parsed frontmatter against.
	 * @param options - Parse options including the file path for error messages.
	 * @returns An object with validated `data` and the remaining `content`.
	 * @throws {SecurityError} With `INJECTION_ATTEMPT` if JavaScript frontmatter is detected.
	 * @throws {SecurityError} With `PROTOTYPE_POLLUTION` if pollution keys are found.
	 * @throws {ParseError} If gray-matter fails to parse or Zod validation fails.
	 */
	parse<T>(
		input: string,
		schema: z.ZodType<T>,
		options: FrontmatterParseOptions,
	): ParsedFrontmatter<T> {
		assertNoJavaScriptFrontmatter(input, options.file);

		const parsed = parseRawFrontmatter(input, options.file);

		assertNoPollutionKeys(parsed.data, options.file);

		const sanitized = ContentSanitizer.sanitize(parsed.data) as Record<string, unknown>;

		const validated = validateWithSchema(sanitized, schema, options.file);

		return {
			data: validated,
			content: parsed.content,
		};
	},

	/**
	 * Checks whether a string contains frontmatter delimiters.
	 *
	 * @param input - The string to check.
	 * @returns `true` if the string starts with a `---` frontmatter delimiter.
	 */
	hasFrontmatter(input: string): boolean {
		return matter.test(input);
	},
} as const;

/**
 * Detects JavaScript frontmatter blocks (`---js` or `---javascript`).
 * The `@11ty/gray-matter` fork disables JS eval, but we add an explicit check
 * as defense-in-depth to reject such content entirely.
 *
 * @param input - The raw input string.
 * @param file - The file path for error messages.
 * @throws {SecurityError} If JavaScript frontmatter is detected.
 */
function assertNoJavaScriptFrontmatter(input: string, file: string): void {
	// Match opening delimiter followed by js/javascript language tag
	const jsPattern = /^---\s*(js|javascript)\s*\r?\n/m;
	if (jsPattern.test(input)) {
		throw new SecurityError({
			threat: SecurityThreat.INJECTION_ATTEMPT,
			message: `JavaScript frontmatter detected in "${file}" — this is not allowed`,
		});
	}
}

/**
 * Parses raw frontmatter using `@11ty/gray-matter` with the JS engine disabled.
 *
 * @param input - The raw input string.
 * @param file - The file path for error messages.
 * @returns The parsed gray-matter result.
 * @throws {ParseError} If gray-matter fails to parse.
 */
function parseRawFrontmatter(
	input: string,
	file: string,
): { data: Record<string, unknown>; content: string } {
	try {
		const result = matter(input, {
			// Only allow YAML — no JS, no CoffeeScript
			language: "yaml",
			// Explicitly disable eval as defense-in-depth
			eval: false,
		});
		return {
			data: (result.data ?? Object.create(null)) as Record<string, unknown>,
			content: result.content,
		};
	} catch (error: unknown) {
		throw new ParseError({
			message: `Failed to parse frontmatter in "${file}"`,
			file,
			cause: error,
		});
	}
}

/**
 * Checks for prototype pollution keys in parsed data before sanitization.
 * Throws a SecurityError to alert callers that the input was malicious.
 *
 * @param data - The raw parsed frontmatter data.
 * @param file - The file path for error messages.
 * @throws {SecurityError} If prototype pollution keys are detected.
 */
function assertNoPollutionKeys(data: Record<string, unknown>, file: string): void {
	if (ContentSanitizer.hasPollutionKeys(data)) {
		throw new SecurityError({
			threat: SecurityThreat.PROTOTYPE_POLLUTION,
			message: `Frontmatter in "${file}" contains prototype pollution keys`,
		});
	}
}

/**
 * Validates sanitized frontmatter data against a Zod schema.
 *
 * @typeParam T - The expected output type.
 * @param data - The sanitized frontmatter data.
 * @param schema - The Zod schema to validate against.
 * @param file - The file path for error messages.
 * @returns The validated data.
 * @throws {ParseError} If Zod validation fails.
 */
function validateWithSchema<T>(
	data: Record<string, unknown>,
	schema: z.ZodType<T>,
	file: string,
): T {
	const result = schema.safeParse(data);
	if (result.success) {
		return result.data;
	}

	// Build a safe error message from Zod issues — never include raw YAML
	const issues = result.error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
			return `${path}: ${issue.message}`;
		})
		.join("; ");

	throw new ParseError({
		message: `Invalid frontmatter in "${file}": ${issues}`,
		file,
		cause: result.error,
	});
}
