/**
 * Annotation module barrel export.
 *
 * Exports all annotation-related classes, types, and constants from the
 * ai-index auto-extraction system introduced in Chunk 13A.
 *
 * @packageDocumentation
 */

export { AI_INDEX_FILENAME, AiIndexBuilder } from "./ai-index-builder.js";
export { AiIndexManager } from "./ai-index-manager.js";
export { AutoExtractor } from "./auto-extractor.js";
export type {
	AiIndex,
	FileEntry,
	ParsedFile,
	ParsedSymbol,
	SymbolEntry,
	SymbolSurface,
} from "./types.js";
