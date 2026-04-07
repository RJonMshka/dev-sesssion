/**
 * Adapter registry — resolves a detected tool to its bootstrap formatter.
 *
 * Maps {@link DetectedToolValue} identifiers to the corresponding
 * {@link BootstrapFormatter} implementation. Falls back to
 * {@link PlainTextFormatter} for unknown tools.
 *
 * @packageDocumentation
 */

import type { BootstrapFormatter, DetectedToolValue } from "@dev-session/core";
import { DetectedTool, PlainTextFormatter } from "@dev-session/core";
import { ClaudeBootstrapFormatter } from "./claude-bootstrap-formatter.js";
import { CursorBootstrapFormatter } from "./cursor-bootstrap-formatter.js";
import { OpencodeBootstrapFormatter } from "./opencode-bootstrap-formatter.js";

/**
 * Internal mapping of tool identifiers to formatter instances.
 *
 * Uses `Object.create(null)` per project security conventions to avoid
 * prototype pollution on the lookup table.
 */
const FORMATTER_MAP: Record<string, BootstrapFormatter> = Object.assign(
	Object.create(null) as Record<string, BootstrapFormatter>,
	{
		[DetectedTool.CLAUDE]: ClaudeBootstrapFormatter,
		[DetectedTool.OPENCODE]: OpencodeBootstrapFormatter,
		[DetectedTool.CURSOR]: CursorBootstrapFormatter,
		[DetectedTool.UNKNOWN]: PlainTextFormatter,
	},
);

/**
 * Resolves a detected tool identifier to the appropriate bootstrap formatter.
 *
 * Falls back to {@link PlainTextFormatter} if the tool is unknown or not
 * recognized in the registry.
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
	const formatter: BootstrapFormatter | undefined = FORMATTER_MAP[tool];
	return formatter ?? PlainTextFormatter;
}

/**
 * Returns all registered formatter names.
 *
 * Useful for listing supported tools in help text or diagnostics.
 *
 * @returns Array of registered tool identifiers.
 */
export function getRegisteredTools(): readonly string[] {
	return Object.keys(FORMATTER_MAP);
}
