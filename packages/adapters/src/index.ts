/**
 * @dev-session/adapters
 *
 * Tool-specific adapters for dev-sesssion.
 * Provides full lifecycle adapters and bootstrap formatters for Claude Code, opencode, Cursor, and Windsurf.
 *
 * Use {@link getAdapterForTool} to resolve a detected tool to its full adapter,
 * or {@link getFormatterForTool} for just the formatter.
 *
 * @packageDocumentation
 */

// Full lifecycle adapters
export { ClaudeAdapter } from "./claude-adapter.js";
// Formatters
export { ClaudeBootstrapFormatter } from "./claude-bootstrap-formatter.js";
export { CursorAdapter } from "./cursor-adapter.js";
export { CursorBootstrapFormatter } from "./cursor-bootstrap-formatter.js";
export { OpencodeAdapter } from "./opencode-adapter.js";
export { OpencodeBootstrapFormatter } from "./opencode-bootstrap-formatter.js";
// Registry
export { getAdapterForTool, getFormatterForTool, getRegisteredTools } from "./registry.js";
export { WindsurfAdapter } from "./windsurf-adapter.js";
export { WindsurfBootstrapFormatter } from "./windsurf-bootstrap-formatter.js";
