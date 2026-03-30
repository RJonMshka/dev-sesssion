/**
 * Enumeration of known security threat categories.
 *
 * Used by {@link SecurityError} to classify the type of threat detected.
 */
export const SecurityThreat = {
	/** Path resolves outside the allowed project root boundary. */
	PATH_TRAVERSAL: "PATH_TRAVERSAL",
	/** Content contains a known secret pattern (API key, token, etc.). */
	SECRET_DETECTED: "SECRET_DETECTED",
	/** Input contains executable code or injection attempt (e.g., JS in YAML frontmatter). */
	INJECTION_ATTEMPT: "INJECTION_ATTEMPT",
	/** Parsed object contains prototype pollution keys (__proto__, constructor, prototype). */
	PROTOTYPE_POLLUTION: "PROTOTYPE_POLLUTION",
} as const;

/** Union type of all security threat categories. */
export type SecurityThreat = (typeof SecurityThreat)[keyof typeof SecurityThreat];
