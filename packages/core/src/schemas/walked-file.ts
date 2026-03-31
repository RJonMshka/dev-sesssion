/**
 * A file discovered by the GitignoreAwareWalker.
 */
export interface WalkedFile {
	/** The relative file path from the project root. */
	readonly relativePath: string;
	/** The absolute file path. */
	readonly absolutePath: string;
	/** The file size in bytes. */
	readonly sizeBytes: number;
}

/**
 * A group of files organized by their parent directory.
 */
export interface DirectoryGroup {
	/** The relative directory path from the project root. */
	readonly directory: string;
	/** The files in this directory. */
	readonly files: readonly WalkedFile[];
	/** The total size of all files in this group, in bytes. */
	readonly totalSizeBytes: number;
}

/**
 * Options for the walker.
 */
export interface WalkOptions {
	/** Additional glob patterns to ignore (on top of .gitignore). */
	readonly ignore?: readonly string[];
	/** Maximum depth to walk (undefined = no limit). */
	readonly maxDepth?: number;
	/** File extensions to include (e.g., [".ts", ".md"]). Empty = all files. */
	readonly extensions?: readonly string[];
}
