export type {
  ExecutionPlan,
  PlanStep,
  PlannerPipelineResult,
  PlannerShadowRecord,
  PlanSource,
  ToolCategory,
  ToolDefinition,
  ValidationResult,
} from "./planTypes.js";

export { normalizeIntent } from "./intentNormalizer.js";
export {
  PLANNER_TOOLS,
  TOOL_MANIFEST_VERSION,
  getToolDefinition,
  getToolManifest,
  isKnownTool,
} from "./toolDefinitions.js";
export { tryL0CompoundPlan, runCompoundPlanner } from "./l0CompoundPlanner.js";
export { writeToolManifestFile } from "./toolManifestWriter.js";
export {
  classifyUtterance,
  compoundStickyEnabled,
  getCompoundParts,
} from "./utteranceClassifier.js";
export {
  isPlannerTraceEnabled,
  tracePlannerBranch,
  tracePipelineTier,
  traceExecutorPayload,
} from "./plannerTrace.js";
export type { L0PlannerResult } from "./planTypes.js";
export { runL0Planner, runAtomicPlanner, parsedToPlanSteps } from "./l0Planner.js";
export { validatePlan, passesConfidenceGate } from "./planValidator.js";
export {
  executionPlanToPayload,
  parsedInputToPayload,
  typeIntentToPayload,
} from "./executionPlanToPayload.js";
export {
  tryCompoundGate,
  tryCompoundGateClarify,
  shouldBlockLegacyForCompound,
  isCompoundUtterance,
} from "./compoundGate.js";
export { shouldBlockLegacyDesktopRouters } from "./p85LegacyGate.js";
export {
  plannerV2CompoundEnabled,
  plannerV2AtomicEnabled,
  logPlannerV2BootLine,
} from "./v2/plannerV2Config.js";
export { planCompoundWithV2, planAtomicWithV2 } from "./v2/plannerV2.js";
export {
  tryL0PartialCompoundPlan,
  validatePartialPlan,
  buildCompoundPartialResult,
} from "./compoundSplit.js";
export {
  phaseBStage1Enabled,
  phaseBPartialExecuteEnabled,
  phaseBExecuteEnabled,
  phaseBAnyEnabled,
  logPhaseBBootLine,
} from "./phaseBConfig.js";
export {
  tryPlanUnresolvedClause,
  tryPlanUnresolvedClauses,
  compoundPartialTailQuestion,
} from "./compoundUnresolvedPlanner.js";
export { executeCompoundPartialPlan } from "./compoundPartialExecutor.js";
export { logPhaseBSplit } from "./planLogger.js";
export { runPlannerPipeline, runPlannerPipelineAsync } from "./plannerPipeline.js";
export { buildExecutorPayload } from "./plannerExecutor.js";
export type { PlannerExecutorResult } from "./plannerExecutor.js";
export { buildPlannerPromptContext, intentHintForDeferReason } from "./plannerPrompt.js";
export { executionPlanFromLlmPlan } from "./gptPlanMapper.js";
export { tryGptPlannerFallback } from "./gptPlannerBridge.js";
export {
  isMessagingAdapterCommand,
  isPlannerGptCandidate,
  shouldBypassP85Planner,
  shouldTryGptFallback,
} from "./gptFallbackPolicy.js";
export { tryGroundedDesktopPayload } from "./groundedPlannerBridge.js";
export {
  isPlannerShadowMode,
  isExecutionPlanLogEnabled,
  logExecutionPlan,
  logPayloadBridgeDiagnostic,
  logPlannerShadow,
  logPlannerRouterMismatch,
  setPlannerShadowMode,
} from "./planLogger.js";
export {
  getPlannerMetrics,
  formatPlannerMetricsLine,
  resetPlannerMetrics,
} from "./planMetrics.js";
export { P85_UTTERANCE_FIXTURES } from "./utteranceFixtures.js";
export { plannerConfig } from "./plannerConfig.js";
export {
  evaluatePlanConfidence,
  confidenceDecisionLabel,
} from "./confidenceEngine.js";
export {
  lookupCachedPlan,
  storeCachedPlan,
  clearPlanCache,
  buildPlanCacheKey,
  isPlanCacheable,
  planCacheSize,
} from "./planCache.js";
export {
  beginClarificationRound,
  resolveClarificationFollowUp,
  hasPendingClarification,
  clearClarificationContext,
  clarificationExhaustedMessage,
  clarificationCommandSimilarity,
  isClarificationRetry,
  isSameOrSimilarCommand,
  normalizeForClarifyCompare,
} from "./clarificationEngine.js";
export {
  classifyExecutionFailure,
  attemptP85Recovery,
  recoveryEnabled,
  isSaveStepFailure,
} from "./recoveryEngine.js";
export {
  buildPlannerDashboardSummary,
  formatPlannerDashboardLine,
} from "./planMetricsDashboard.js";
export {
  getRouterParitySnapshot,
  recordRouterMismatch,
  recordP85Execute,
  resetRouterParity,
} from "./routerParity.js";
export {
  queryPlannerShadowFromDb,
  exportPlannerShadowCsv,
} from "./planPersistence.js";
export {
  observeP85Execution,
  getRecentExecutionObservations,
  resetExecutionObservations,
  exportExecutionObservationsCsv,
  type ExecutionObservation,
} from "./executionObserver.js";
export { executePlan } from "./toolExecutor.js";
export type { ToolExecutorSummary } from "./toolExecutor.js";
export {
  isToolExecutorRouteEnabled,
  planEligibleForToolExecutor,
  runPlanViaToolExecutor,
  toolExecutorSummaryToActionRunSummary,
  ensurePhase1ToolsRegistered,
  ensureP85ToolsRegistered,
} from "./toolExecutorBridge.js";
export {
  registerPhase1DesktopTools,
  listPhase1DesktopToolNames,
} from "./tools/desktopTools.js";
export {
  registerPhase2FilesystemTools,
  listPhase2FilesystemToolNames,
  resetPhase2FilesystemToolsForTests,
} from "./tools/filesystemTools.js";
export {
  registerPhase1SystemTools,
  listPhase1SystemToolNames,
  resetPhase1SystemToolsForTests,
} from "./tools/systemTools.js";
export {
  checkRateLimitForTool,
  permissionPass1ForStep,
  permissionPass2ForStep,
  confirmStepIfNeeded,
  needsPermissionPass2,
  toolToRateLimitKey,
} from "./toolExecutorSafety.js";
export { PLANNER_VERSION } from "./plannerConstants.js";
export { stampExecutionPlan } from "./planStamping.js";
export {
  bindStepArgs,
  resolveAppPhrase,
  resolveEntities,
  tryResolveLaunchIntent,
} from "./entityResolver.js";
export { observeToolStep } from "./stepObserver.js";
export {
  runExecution,
  runValidatedPlanExecution,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutionFailureKind,
} from "./executionRequest.js";
export {
  legacyAgentCompoundEnabled,
  legacyDesktopEarlyInputEnabled,
  legacyDesktopRoutersEnabled,
  legacyKillSwitchActive,
  legacyPlanDesktopEnabled,
  p85DesktopEntryEnabled,
} from "./legacyRouterGate.js";
export {
  comparePlanToLegacyPayload,
  isLegacyNoopOnly,
  isShadowParityCompareEnabled,
  planUsesP85ExtensionTools,
  resolveLegacyDesktopPayload,
  runShadowParityOnExecute,
  type LegacyRouterKind,
  type ShadowParityResult,
} from "./shadowParity.js";
