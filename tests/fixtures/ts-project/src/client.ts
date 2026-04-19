/**
 * HTTP client for the ts-project fixture.
 *
 * @packageDocumentation
 */

import type { ClientConfig } from "./utils.js";

/**
 * A minimal HTTP client.
 *
 * @example
 * ```typescript
 * const client = new Client({ timeout: 5000, retries: 3 });
 * ```
 */
export class Client {
	private readonly config: ClientConfig;

	/**
	 * Create a new Client.
	 *
	 * @param config - Client configuration.
	 */
	constructor(config: ClientConfig) {
		this.config = config;
	}

	/**
	 * Fetch a resource.
	 *
	 * @param url - The URL to fetch.
	 * @returns The response body as a string.
	 */
	async fetch(url: string): Promise<string> {
		void url;
		return "response";
	}
}

/** Default client configuration. */
export const DEFAULT_CONFIG: ClientConfig = {
	timeout: 5000,
	retries: 3,
};
