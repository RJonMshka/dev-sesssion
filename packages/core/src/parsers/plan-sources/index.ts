/**
 * Plan source registry — many plan dialects in, one `PlanChunk[]` out.
 *
 * @packageDocumentation
 */

export type { PlanCheckCandidate, PlanCheckChunk, PlanCheckReport } from "./check.js";
export { checkPlan, describeExclusion } from "./check.js";
export type { NoPlanDirectionOptions } from "./direction.js";
export {
	CHUNK_HEADING_SHAPE,
	DEFAULT_PLAN_PATHS,
	INIT_WITH_PLAN_COMMAND,
	noPlanDirection,
	PLAN_CHECK_COMMAND,
} from "./direction.js";
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
