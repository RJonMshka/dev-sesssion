import { z } from "zod";

/**
 * Detected AI tool types.
 */
export const DetectedTool = {
	CLAUDE: "claude",
	OPENCODE: "opencode",
	CURSOR: "cursor",
	UNKNOWN: "unknown",
} as const;

/** Union type of detected AI tool identifiers. */
export type DetectedToolValue = (typeof DetectedTool)[keyof typeof DetectedTool];

/**
 * Detected project framework types.
 */
export const ProjectType = {
	VITE: "vite",
	NEXT: "next",
	NODE: "node",
	UNKNOWN: "unknown",
} as const;

/** Union type of detected project framework identifiers. */
export type ProjectTypeValue = (typeof ProjectType)[keyof typeof ProjectType];

/**
 * Zod schema for detected project information.
 */
export const ProjectInfoSchema = z
	.object({
		/** The detected AI coding tool. */
		tool: z.enum(["claude", "opencode", "cursor", "unknown"]),
		/** The detected project framework type. */
		project_type: z.enum(["vite", "next", "node", "unknown"]),
		/** Existing notable files found in the project root. */
		existing_files: z.array(z.string()),
		/** The absolute path to the project root. */
		project_root: z.string().min(1),
		/** Whether a .session/ directory already exists. */
		has_existing_session: z.boolean(),
		/** The project name (from package.json or directory name). */
		project_name: z.string().optional(),
	})
	.strict();

/**
 * Information about the detected project environment.
 */
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;
