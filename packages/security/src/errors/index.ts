/**
 * Error types for dev-session security package.
 *
 * All error types extend `Error` and include a discriminant `name` property
 * for reliable runtime type checking.
 *
 * @packageDocumentation
 */

export type { CliErrorOptions } from "./cli-error.js";
export { CliError, isCliError } from "./cli-error.js";
export type { ParseErrorOptions } from "./parse-error.js";
export { isParseError, ParseError } from "./parse-error.js";
export type { SecurityErrorOptions } from "./security-error.js";
export { isSecurityError, SecurityError } from "./security-error.js";

export { SecurityThreat } from "./security-threat.js";
