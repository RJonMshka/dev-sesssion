/**
 * @dev-session/security
 *
 * Security primitives for dev-sesssion.
 * Zero internal dependencies. Built and tested first.
 *
 * @packageDocumentation
 */

// Error types
export type {
	CliErrorOptions,
	ParseErrorOptions,
	SecurityErrorOptions,
} from "./errors/index.js";
export {
	CliError,
	isCliError,
	isParseError,
	isSecurityError,
	ParseError,
	SecurityError,
	SecurityThreat,
} from "./errors/index.js";
// Guards
export type {
	WriteGuardOptions,
	WriteGuardResult,
} from "./guards/write-guard.js";
export { WriteGuard } from "./guards/write-guard.js";
// Parsers
export type {
	FrontmatterParseOptions,
	ParsedFrontmatter,
} from "./parsers/frontmatter-parser.js";
export { FrontmatterParser } from "./parsers/frontmatter-parser.js";
// Sanitizers
export type { SanitizeOptions } from "./sanitizers/content-sanitizer.js";
export { ContentSanitizer } from "./sanitizers/content-sanitizer.js";

// Scanners
export type { ScanResult } from "./scanners/secret-scanner.js";
export { SecretScanner } from "./scanners/secret-scanner.js";
// Validators
export type { ValidatedPath } from "./validators/path-validator.js";
export { PathValidator } from "./validators/path-validator.js";

// Writers
export type {
	AtomicWriteOptions,
	AtomicWriteResult,
} from "./writers/atomic-writer.js";
export { AtomicWriter } from "./writers/atomic-writer.js";

/** Package version identifier. */
export const SECURITY_VERSION = "0.0.0" as const;
