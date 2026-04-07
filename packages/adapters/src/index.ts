/**
 * @dev-session/adapters
 *
 * Tool-specific adapters for dev-session.
 * Provides bootstrap formatters optimized for Claude Code, opencode, and Cursor.
 *
 * Use {@link getFormatterForTool} to resolve a detected tool to its formatter,
 * or import a specific formatter directly.
 *
 * @packageDocumentation
 */

// Formatters
export { ClaudeBootstrapFormatter } from "./claude-bootstrap-formatter.js";
export { CursorBootstrapFormatter } from "./cursor-bootstrap-formatter.js";
export { OpencodeBootstrapFormatter } from "./opencode-bootstrap-formatter.js";

// Registry
export { getFormatterForTool, getRegisteredTools } from "./registry.js";
