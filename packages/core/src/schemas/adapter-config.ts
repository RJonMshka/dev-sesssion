import { z } from "zod";

/**
 * Zod schema for the adapter configuration contract.
 *
 * This defines the public interface that community adapters must satisfy.
 * Adapters transform session state into tool-specific file formats.
 */
export const AdapterConfigSchema = z
	.object({
		/** Unique identifier for the adapter (e.g., "claude", "opencode"). */
		name: z.string().min(1),
		/** Human-readable display name. */
		display_name: z.string().min(1),
		/** The files this adapter reads to detect the tool (e.g., ["CLAUDE.md", ".claude/"]). */
		detect_files: z.array(z.string().min(1)).min(1),
		/** The files this adapter generates or modifies. */
		output_files: z.array(z.string().min(1)).min(1),
		/** Version of the adapter config contract this adapter targets. */
		config_version: z.number().int().min(1),
	})
	.strict();

/**
 * The public contract for community adapters.
 */
export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;
