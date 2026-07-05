/**
 * Adapter registry — resolves a detected tool to its adapter or formatter.
 *
 * Ships with built-in adapters (Claude Code, opencode, Cursor, Windsurf) and
 * accepts custom adapters at runtime via {@link registerAdapter}. Falls back
 * to a minimal adapter wrapping {@link PlainTextFormatter} for unknown tools.
 *
 * @packageDocumentation
 */

import type { Adapter, BootstrapFormatter, DetectedToolValue } from "@dev-session/core";
import { CliError, DetectedTool, PlainTextFormatter } from "@dev-session/core";
import { ClaudeAdapter } from "./claude-adapter.js";
import { CursorAdapter } from "./cursor-adapter.js";
import { OpencodeAdapter } from "./opencode-adapter.js";
import { WindsurfAdapter } from "./windsurf-adapter.js";

/**
 * Minimal fallback adapter for unknown tools.
 *
 * Uses {@link PlainTextFormatter} and has no lifecycle hooks.
 */
const FALLBACK_ADAPTER: Adapter = {
	config: {
		name: "plain",
		display_name: "Plain Text (fallback)",
		detect_files: [],
		output_files: [],
		config_version: 1,
	},
	formatter: PlainTextFormatter,
};

// Object.create(null) per project security conventions: no prototype keys
// on a lookup table indexed by external strings.
const BUILTIN_ADAPTERS: Record<string, Adapter> = Object.assign(
	Object.create(null) as Record<string, Adapter>,
	{
		[DetectedTool.CLAUDE]: ClaudeAdapter,
		[DetectedTool.OPENCODE]: OpencodeAdapter,
		[DetectedTool.CURSOR]: CursorAdapter,
		[DetectedTool.WINDSURF]: WindsurfAdapter,
		[DetectedTool.UNKNOWN]: FALLBACK_ADAPTER,
	},
);

const customAdapters = new Map<string, Adapter>();

const ADAPTER_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Registers a custom adapter under its `config.name`.
 *
 * Once registered, the adapter resolves through {@link getAdapterByName} and
 * appears in {@link getRegisteredTools}, which also makes it accepted by the
 * CLI's `--adapter` flag. Registration is in-process only — it does not
 * persist across CLI invocations.
 *
 * @param adapter - The adapter to register.
 * @throws {CliError} If the name is not lowercase kebab-case, or is already
 *   registered (built-in names and `"plain"` are reserved).
 */
export function registerAdapter(adapter: Adapter): void {
	const name = adapter.config.name;

	if (!ADAPTER_NAME_PATTERN.test(name)) {
		throw new CliError({
			message: `Invalid adapter name: "${name}"`,
			suggestion: 'Adapter names must be lowercase kebab-case, e.g. "my-tool".',
		});
	}

	if (
		name in BUILTIN_ADAPTERS ||
		customAdapters.has(name) ||
		name === FALLBACK_ADAPTER.config.name
	) {
		throw new CliError({
			message: `Adapter "${name}" is already registered`,
			suggestion: "Choose a unique name, or call unregisterAdapter() first for a custom adapter.",
		});
	}

	customAdapters.set(name, adapter);
}

/**
 * Removes a previously registered custom adapter.
 *
 * Built-in adapters cannot be removed.
 *
 * @param name - The `config.name` the adapter was registered under.
 * @returns `true` if a custom adapter was removed, `false` otherwise.
 */
export function unregisterAdapter(name: string): boolean {
	return customAdapters.delete(name);
}

/**
 * Resolves an adapter by name, checking built-ins first, then custom
 * registrations.
 *
 * @param name - A tool identifier or custom adapter name.
 * @returns The matching {@link Adapter}, or `undefined` if none is registered.
 */
export function getAdapterByName(name: string): Adapter | undefined {
	return BUILTIN_ADAPTERS[name] ?? customAdapters.get(name);
}

/**
 * Resolves a detected tool identifier to the full lifecycle adapter.
 *
 * Falls back to a minimal adapter wrapping {@link PlainTextFormatter}
 * if the tool is unknown or not recognized.
 *
 * @param tool - The detected tool identifier from {@link ProjectDetector}.
 * @returns The matching {@link Adapter} implementation.
 *
 * @example
 * ```typescript
 * import { DetectedTool } from "@dev-session/core";
 * import { getAdapterForTool } from "@dev-session/adapters";
 *
 * const adapter = getAdapterForTool(DetectedTool.CLAUDE);
 * // adapter.config.name === "claude"
 * ```
 */
export function getAdapterForTool(tool: DetectedToolValue): Adapter {
	return getAdapterByName(tool) ?? FALLBACK_ADAPTER;
}

/**
 * Resolves a detected tool identifier to the appropriate bootstrap formatter.
 *
 * Convenience wrapper around {@link getAdapterForTool} for code that only
 * needs the formatter, not the full adapter lifecycle.
 *
 * @param tool - The detected tool identifier from {@link ProjectDetector}.
 * @returns The matching {@link BootstrapFormatter} implementation.
 */
export function getFormatterForTool(tool: DetectedToolValue): BootstrapFormatter {
	return getAdapterForTool(tool).formatter;
}

/**
 * Returns all registered adapter names: built-in tools first, then custom
 * registrations.
 *
 * @returns Array of registered tool identifiers.
 */
export function getRegisteredTools(): readonly string[] {
	return [...Object.keys(BUILTIN_ADAPTERS), ...customAdapters.keys()];
}
