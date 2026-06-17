/**
 * Annotation module barrel export.
 *
 * Exports all annotation-related classes, types, and constants from the
 * ai-index auto-extraction system (Chunk 12) and the `@ai-*` annotation
 * refinement layer (Chunk 13).
 *
 * @packageDocumentation
 */

export { AI_INDEX_FILENAME, AiIndexBuilder } from "./ai-index-builder.js";
export { AiIndexManager } from "./ai-index-manager.js";
export type { FileAnnotations, LayerHint, SymbolAnnotations } from "./annotation-parser.js";
export { AnnotationParser } from "./annotation-parser.js";
export { AutoExtractor } from "./auto-extractor.js";
export type {
	AiIndex,
	FileEntry,
	ParsedFile,
	ParsedSymbol,
	SymbolEntry,
	SymbolSurface,
} from "./types.js";
