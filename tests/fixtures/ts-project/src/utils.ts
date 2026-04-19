/**
 * Utility functions for the ts-project fixture.
 *
 * @packageDocumentation
 */

/**
 * Adds two numbers together.
 *
 * @param a - First operand.
 * @param b - Second operand.
 * @returns The sum of a and b.
 */
export function add(a: number, b: number): number {
	return a + b;
}

/**
 * Greets a user by name.
 *
 * @param name - The user's name.
 * @returns A greeting string.
 */
export function greet(name: string): string {
	return `Hello, ${name}!`;
}

/** Maximum retry count for operations. */
export const MAX_RETRIES = 3;

/** Configuration type for the client. */
export type ClientConfig = {
	timeout: number;
	retries: number;
};
