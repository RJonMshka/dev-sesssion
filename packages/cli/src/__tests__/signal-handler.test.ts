import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTesting, installSignalHandlers, onCleanup } from "../utils/signal-handler.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
	log: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
		step: vi.fn(),
	},
}));

describe("signal-handler", () => {
	beforeEach(() => {
		_resetForTesting();
	});

	afterEach(() => {
		_resetForTesting();
	});

	describe("onCleanup", () => {
		it("registers a cleanup function", () => {
			const fn = vi.fn();
			const dispose = onCleanup(fn);
			expect(typeof dispose).toBe("function");
		});

		it("returns a dispose function that unregisters the callback", () => {
			const fn = vi.fn();
			const dispose = onCleanup(fn);
			dispose();
			// Verify it doesn't throw on double-dispose
			dispose();
		});
	});

	describe("installSignalHandlers", () => {
		it("returns a dispose function", () => {
			const dispose = installSignalHandlers();
			expect(typeof dispose).toBe("function");
			dispose();
		});

		it("dispose removes signal listeners", () => {
			const listenersBefore = process.listenerCount("SIGINT");
			const dispose = installSignalHandlers();
			const listenersAfter = process.listenerCount("SIGINT");
			expect(listenersAfter).toBe(listenersBefore + 1);

			dispose();
			const listenersDisposed = process.listenerCount("SIGINT");
			expect(listenersDisposed).toBe(listenersBefore);
		});

		it("installs both SIGINT and SIGTERM handlers", () => {
			const sigintBefore = process.listenerCount("SIGINT");
			const sigtermBefore = process.listenerCount("SIGTERM");

			const dispose = installSignalHandlers();

			expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
			expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

			dispose();
		});
	});
});
