/**
 * Plan source registry — many plan dialects in, one `PlanChunk[]` out.
 *
 * @packageDocumentation
 */

export { HeadingPlanSource } from "./heading-source.js";
export type { PlanIngestResult, PlanSourceCandidate } from "./registry.js";
export {
	detectPlanSource,
	formatCandidates,
	getPlanSourceByName,
	getRegisteredPlanSources,
	PLAN_SOURCE_MIN_CONFIDENCE,
	parsePlan,
	registerPlanSource,
	unregisterPlanSource,
} from "./registry.js";
export { TaskListPlanSource } from "./task-list-source.js";
export type {
	ExcludedSection,
	ExclusionReason,
	PlanParseResult,
	PlanSource,
	PlanSourceDetection,
} from "./types.js";
