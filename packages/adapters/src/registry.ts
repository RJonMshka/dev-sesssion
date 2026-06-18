/**
 * Adapter registry — resolves a detected tool to its adapter or formatter.
 *
 * Maps {@link DetectedToolValue} identifiers to the corresponding
 * {@link Adapter} implementation. Falls back to a minimal adapter wrapping
 * {@link PlainTextFormatter} for unknown tools.
 *
 * @packageDocumentation
 */

import type { Adapter, BootstrapFormatter, DetectedToolValue } from "@dev-session/core";
import { DetectedTool, PlainTextFormatter } from "@dev-session/core";
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

/**
 * Internal mapping of tool identifiers to adapter instances.
 *
 * Uses `Object.create(null)` per project security conventions to avoid
 * prototype pollution on the lookup table.
 */
const ADAPTER_MAP: Record<string, Adapter> = Object.assign(
	Object.create(null) as Record<string, Adapter>,
	{
		[DetectedTool.CLAUDE]: ClaudeAdapter,
		[DetectedTool.OPENCODE]: OpencodeAdapter,
		[DetectedTool.CURSOR]: CursorAdapter,
		[DetectedTool.WINDSURF]: WindsurfAdapter,
		[DetectedTool.UNKNOWN]: FALLBACK_ADAPTER,
	},
);

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
 * // adapter.formatter.name === "claude"
 * ```
 */
export function getAdapterForTool(tool: DetectedToolValue): Adapter {
	const adapter: Adapter | undefined = ADAPTER_MAP[tool];
	return adapter ?? FALLBACK_ADAPTER;
}

/**
 * Resolves a detected tool identifier to the appropriate bootstrap formatter.
 *
 * Convenience wrapper around {@link getAdapterForTool} for code that only
 * needs the formatter, not the full adapter lifecycle.
 *
 * @param tool - The detected tool identifier from {@link ProjectDetector}.
 * @returns The matching {@link BootstrapFormatter} implementation.
 *
 * @example
 * ```typescript
 * import { DetectedTool } from "@dev-session/core";
 * import { getFormatterForTool } from "@dev-session/adapters";
 *
 * const formatter = getFormatterForTool(DetectedTool.CLAUDE);
 * // formatter.name === "claude"
 * ```
 */
export function getFormatterForTool(tool: DetectedToolValue): BootstrapFormatter {
	return getAdapterForTool(tool).formatter;
}

/**
 * Returns all registered adapter names.
 *
 * Useful for listing supported tools in help text or diagnostics.
 *
 * @returns Array of registered tool identifiers.
 */
export function getRegisteredTools(): readonly string[] {
	return Object.keys(ADAPTER_MAP);
}
