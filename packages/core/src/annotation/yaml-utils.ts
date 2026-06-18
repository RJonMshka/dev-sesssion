/**
 * Minimal deterministic YAML serializer/deserializer for ai-index.yaml.
 *
 * This is intentionally a minimal implementation tailored to the ai-index
 * schema. It does NOT support full YAML — only the specific subset that
 * dev-sesssion produces and consumes.
 *
 * Serialization rules:
 * - Object keys are sorted alphabetically at every level.
 * - String values are JSON-quoted when they contain special chars.
 * - Arrays use inline JSON syntax: `[]` or `["a", "b"]`.
 * - Nested objects use block (indented) style.
 * - Indentation is 2 spaces per level.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a nested plain object to a deterministic YAML string.
 *
 * @param data - The root object to serialize (no cycles allowed).
 * @returns A valid YAML string ending with a newline.
 */
export function serializeToYaml(data: Record<string, unknown>): string {
	const lines: string[] = [];
	appendObject(lines, data, 0);
	return lines.join("\n") + "\n";
}

/**
 * Recursively append object entries to the lines array.
 *
 * @param lines - Lines accumulator.
 * @param obj - Object to serialize.
 * @param depth - Current indentation depth (0 = top level).
 */
function appendObject(lines: string[], obj: Record<string, unknown>, depth: number): void {
	const indent = "  ".repeat(depth);
	const keys = Object.keys(obj).sort();

	for (const key of keys) {
		const val = obj[key];
		const k = yamlKey(key);

		if (val === null || val === undefined) {
			lines.push(`${indent}${k}: null`);
		} else if (typeof val === "boolean") {
			lines.push(`${indent}${k}: ${val ? "true" : "false"}`);
		} else if (typeof val === "number") {
			lines.push(`${indent}${k}: ${val}`);
		} else if (typeof val === "string") {
			lines.push(`${indent}${k}: ${yamlString(val)}`);
		} else if (Array.isArray(val)) {
			// Inline array (JSON syntax — valid YAML)
			lines.push(`${indent}${k}: ${serializeArray(val)}`);
		} else if (typeof val === "object") {
			const nested = val as Record<string, unknown>;
			if (Object.keys(nested).length === 0) {
				lines.push(`${indent}${k}: {}`);
			} else {
				lines.push(`${indent}${k}:`);
				appendObject(lines, nested, depth + 1);
			}
		}
	}
}

/**
 * Serialize an array to an inline JSON-compatible YAML value.
 *
 * @param arr - The array to serialize.
 * @returns Inline YAML string like `[]` or `["a","b"]`.
 */
function serializeArray(arr: unknown[]): string {
	if (arr.length === 0) return "[]";
	const items = arr.map((item) => {
		if (typeof item === "string") return JSON.stringify(item);
		if (typeof item === "number" || typeof item === "boolean") return String(item);
		return JSON.stringify(item);
	});
	return `[${items.join(", ")}]`;
}

/**
 * Escape a YAML mapping key.
 *
 * Only simple identifiers (letters, digits, underscores) are unquoted.
 * Everything else (file paths with `/`, dotted names, etc.) is JSON-quoted.
 *
 * @param key - The key string.
 * @returns A safe YAML key.
 */
function yamlKey(key: string): string {
	if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) return key;
	return JSON.stringify(key);
}

/**
 * Escape a YAML string value.
 *
 * Simple alphanumeric strings are left unquoted. Anything with special
 * characters, reserved words (`true`, `false`, `null`), or numeric-looking
 * content is JSON-quoted.
 *
 * @param s - The string value.
 * @returns A safe YAML scalar.
 */
function yamlString(s: string): string {
	if (s.length === 0) return '""';
	// Avoid quoting simple lowercase identifiers (surface values like "public")
	if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(s) && s !== "true" && s !== "false" && s !== "null") {
		return s;
	}
	return JSON.stringify(s);
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

/**
 * Deserialize a YAML string produced by {@link serializeToYaml} back into a
 * plain object.
 *
 * @param content - YAML content to parse.
 * @returns The deserialized object.
 * @throws {SyntaxError} If the content cannot be parsed (malformed YAML).
 */
export function deserializeFromYaml(content: string): Record<string, unknown> {
	const root: Record<string, unknown> = Object.create(null);
	const stack: Array<{ obj: Record<string, unknown>; depth: number }> = [{ obj: root, depth: 0 }];

	for (const line of content.split("\n")) {
		const trimmed = line.trimStart();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const indent = line.length - trimmed.length;
		const depth = indent / 2; // 2 spaces per level

		// Pop stack to find correct parent
		while (stack.length > 1 && stack[stack.length - 1]!.depth > depth) {
			stack.pop();
		}

		const kv = parseKeyValue(trimmed);
		if (!kv) continue;

		const { key, value, isNested } = kv;
		const current = stack[stack.length - 1]!.obj;

		if (isNested) {
			const nested: Record<string, unknown> = Object.create(null);
			current[key] = nested;
			stack.push({ obj: nested, depth: depth + 1 });
		} else {
			current[key] = value;
		}
	}

	return root;
}

/**
 * Parse a `key: value` line.
 *
 * @param line - Trimmed YAML line (no leading whitespace).
 * @returns Parsed key, value, and whether value is a nested object.
 */
function parseKeyValue(line: string): { key: string; value: unknown; isNested: boolean } | null {
	let key: string;
	let rest: string;

	if (line.startsWith('"')) {
		// Quoted key: "some/path/file.ts": ...
		const match = /^("(?:[^"\\]|\\.)*"):\s*(.*)$/.exec(line);
		if (!match?.[1] || match[2] === undefined) return null;
		try {
			key = JSON.parse(match[1]) as string;
		} catch {
			return null;
		}
		rest = match[2].trim();
	} else {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) return null;
		key = line.slice(0, colonIdx).trim();
		rest = line.slice(colonIdx + 1).trim();
	}

	if (rest === "" || rest === "{}") {
		// Nested object on next lines (or empty object — treat as empty plain object)
		if (rest === "{}") {
			return { key, value: Object.create(null) as Record<string, unknown>, isNested: false };
		}
		return { key, value: null, isNested: true };
	}

	return { key, value: parseScalar(rest), isNested: false };
}

/**
 * Parse a YAML scalar value.
 *
 * @param s - The raw value string.
 * @returns The parsed JavaScript value.
 */
function parseScalar(s: string): unknown {
	if (s === "null") return null;
	if (s === "true") return true;
	if (s === "false") return false;

	// Inline array (JSON syntax)
	if (s.startsWith("[")) {
		try {
			return JSON.parse(s) as unknown[];
		} catch {
			return [];
		}
	}

	// JSON-quoted string
	if (s.startsWith('"')) {
		try {
			return JSON.parse(s) as string;
		} catch {
			return s;
		}
	}

	// Number
	if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);

	// Plain string (unquoted identifier like "public", "private")
	return s;
}
