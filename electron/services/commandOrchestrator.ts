import { randomUUID } from "node:crypto";
import { applyWhatsAppVoiceOverride } from "../automation/adapters/whatsapp/whatsappVoiceOverride.js";
import { applyWhatsAppRephraseOverride } from "../automation/adapters/whatsapp/whatsappRephraseOverride.js";
import { buildNotionCommandResult } from "../automation/adapters/notion/notionCommand.js";
import { applyNotionVoiceOverride } from "../automation/adapters/notion/notionVoiceOverride.js";
import { buildYouTubeCommandResult, buildYouTubeCommandFromPlan } from "../automation/adapters/youtube/youtubeCommand.js";
import { fetchYouTubeSearchQueryFromLlm } from "../automation/adapters/youtube/youtubeSearchLlm.js";
import { isLikelyYouTubeSearchCommand } from "../automation/adapters/youtube/parseYouTubeCommand.js";
import { normalizeTranscript } from "../automation/voice/normalizeTranscript.js";
import { applyYouTubeVoiceOverride } from "../automation/adapters/youtube/youtubeVoiceOverride.js";
import { buildLinkedInCommandResult } from "../automation/adapters/linkedin/linkedinCommand.js";
import { applyLinkedInVoiceOverride } from "../automation/adapters/linkedin/linkedinVoiceOverride.js";
import { buildInstagramCommandResult } from "../automation/adapters/instagram/instagramCommand.js";
import { applyInstagramVoiceOverride } from "../automation/adapters/instagram/instagramVoiceOverride.js";
import { isInstagramTabActive, isGmailComposeFocused, isWhatsAppTabActive, isLinkedInTabActive, isYouTubeFocused, isNotionFocused, isDesktopAppForeground } from "../focus/focusContext.js";
import { isContextualLinkedInVoiceCommand, isLinkedInCommand } from "../automation/adapters/linkedin/parseLinkedInCommand.js";
import { isContextualYouTubeVoiceCommand, isYouTubeCommand } from "../automation/adapters/youtube/parseYouTubeCommand.js";
import { looksLikeBoxDrawingMojibake } from "../automation/voice/i18n/repairEncoding.js";
import { repairCorruptedTranscript } from "../automation/voice/i18n/repairEncoding.js";
import { isEditOrRephraseCommand } from "../automation/commandIntent.js";
import { extractRephraseSourceText } from "../automation/rephraseParse.js";
import { resolveBackendContext } from "../automation/appDetector/contextBuilder.js";
import { planDesktopCommand } from "../automation/planner/planExecute.js";
import { guidedNotFound } from "../automation/planner/guidedResponses.js";
import {
  isLikelyDesktopCommand,
  isRegionalLanguageCommand,
} from "../automation/voice/nlu/desktopIntentGuard.js";
import {
  rateLimitForPayload,
  recordActionUse,
  primaryToolFromPayload,
} from "../automation/safety/actionLimiter.js";
import { buildDesktopCommandResult } from "../automation/desktop/desktopCommand.js";
import { commandPayloadFromIntent } from "../automation/desktop/desktopCommand.js";
import { parseUndoCommand } from "../automation/desktop/parseUndoCommand.js";
import { shouldSkipFastPathForGpt } from "../automation/voice/nlu/aiFirstRouting.js";
import { parseWorkflowMetaCommand } from "../automation/desktop/parseWorkflowCommand.js";
import { isRememberWorkflowPhrase } from "../automation/desktop/spokenName.js";
import { commandPayloadFromResolvedPath } from "../automation/desktop/desktopCommand.js";
import { pickItemFromMatches } from "../automation/desktop/disambiguation.js";
import { showClarifyQuestionOnOverlay } from "../windows/overlay.js";
import { confirmEntity, boostEntityFromOpen } from "../storage/knowledgeGraph.js";
import { setCapabilityCacheEntry } from "../storage/capabilityCache.js";
import { recordFileTouch } from "../storage/recordFileTouch.js";
import { buildReferentialWhatsAppResult } from "../automation/adapters/whatsapp/buildReferentialWhatsApp.js";
import { buildWhatsAppCommandResult } from "../automation/adapters/whatsapp/whatsappCommand.js";
import { clearPreprocessCache } from "../automation/voice/nlu/preprocess.js";
import { recordCommandEvent, type PlannerSource } from "../telemetry/commandTelemetry.js";
import { parseGraphOpenCommand } from "../automation/desktop/parseGraphOpenCommand.js";
import {
  recordConversationTurn,
  type TurnOutcome,
} from "../storage/conversationContext.js";
import type { CommandResultPayload } from "../automation/types.js";
import { runCommandActions } from "../automation/actionRunner.js";
import {
  getPermissionBlockMessage,
  PermissionBlockedError,
} from "../automation/safety/permissionGate.js";
import { setLastCommandIntent } from "../state/lastCommand.js";
import { rippleSocket } from "../socket/rippleSocket.js";
import {
  apiExecuteCommand,
  type ApiResponse,
} from "./api.js";
import {
  normalizeDesktopVoiceCommand,
  parseDesktopInputFallback,
} from "../agent/parseDesktopInput.js";
import {
  buildTypingPayloadFromInput,
} from "../agent/typingPayload.js";
import {
  shouldTryAgentCompound,
  tryAgentCompoundCommand,
} from "../agent/agentOrchestrator.js";
import {
  buildWorldModel,
  summarizeWorldForLog,
} from "../agent/worldModel.js";
import {
  planUniversalIntent,
  universalPlanToCommandPayload,
} from "../agent/universalPlanner.js";
import { runPlannerPipelineAsync } from "../agent/planner/plannerPipeline.js";
import { buildExecutorPayload } from "../agent/planner/plannerExecutor.js";
import { runValidatedPlanExecution } from "../agent/planner/executionRequest.js";
import { logPlannerRouterMismatch, logPayloadBridgeDiagnostic } from "../agent/planner/planLogger.js";
import { runShadowParityOnExecute } from "../agent/planner/shadowParity.js";
import {
  legacyAgentCompoundEnabled,
  legacyDesktopEarlyInputEnabled,
  legacyDesktopRoutersEnabled,
  legacyPlanDesktopEnabled,
  p85DesktopEntryEnabled,
} from "../agent/planner/legacyRouterGate.js";
import { formatPlannerMetricsLine, getPlannerMetrics } from "../agent/planner/planMetrics.js";
import { formatPlannerDashboardLine } from "../agent/planner/planMetricsDashboard.js";
import { recordP85Execute } from "../agent/planner/routerParity.js";
import {
  compoundUnresolvedQuestion,
  tryL0CompoundPlan,
} from "../agent/planner/l0CompoundPlanner.js";
import { tryCompoundGate, isCompoundUtterance } from "../agent/planner/compoundGate.js";
import { shouldBlockLegacyDesktopRouters } from "../agent/planner/p85LegacyGate.js";
import { shouldBypassP85Planner } from "../agent/planner/gptFallbackPolicy.js";
import { logPhaseBSplit } from "../agent/planner/planLogger.js";
import { executeCompoundPartialPlan } from "../agent/planner/compoundPartialExecutor.js";
import {
  phaseBStage1Enabled,
} from "../agent/planner/phaseBConfig.js";
import type { PlannerPipelineResult } from "../agent/planner/planTypes.js";
import { normalizeIntent } from "../agent/planner/intentNormalizer.js";
import {
  beginClarificationRound,
  clarificationExhaustedMessage,
  resolveClarificationFollowUp,
} from "../agent/planner/clarificationEngine.js";
import { observeP85Execution } from "../agent/planner/executionObserver.js";
import {
  completeGoal,
  getActiveGoal,
  parseGoalControlCommand,
  pauseGoal,
  startGoal,
  updateGoal,
} from "../agent/goalManager.js";

export interface RunCommandInput {
  command: string;
  sessionId?: string | null;
  contextMetadata?: Record<string, unknown>;
  selectedText?: string | null;
  getAccessToken: () => Promise<string | null>;
}

export interface RunCommandResult {
  ok: boolean;
  message?: string;
  data?: CommandResultPayload & { execution?: unknown };
  usedRestFallback?: boolean;
}

function logConversationTurn(
  command: string,
  outcome: TurnOutcome,
  extra?: { intent?: string; resolved_path?: string },
): void {
  try {
    recordConversationTurn({
      command,
      outcome,
      intent: extra?.intent ?? null,
      resolved_path: extra?.resolved_path ?? null,
    });
  } catch {
    /* local DB optional */
  }
}

async function fetchCommandResult(
  input: RunCommandInput,
): Promise<{ data: CommandResultPayload; usedRestFallback: boolean }> {
  const { contextType, actionSource } = resolveBackendContext(input.contextMetadata);

  if (rippleSocket.isConnected()) {
    try {
      const data = (await rippleSocket.executeCommand({
        command: input.command,
        sessionId: input.sessionId ?? undefined,
        contextType,
        actionSource,
        contextMetadata: input.contextMetadata,
        selectedText: input.selectedText ?? undefined,
      })) as CommandResultPayload;
      return { data, usedRestFallback: false };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Socket command failed";
      console.warn(`[ripple-desktop] socket command failed, trying REST: ${msg}`);
    }
  } else {
    console.warn("[ripple-desktop] socket offline — using REST /commands/execute");
  }

  const access = await input.getAccessToken();
  if (!access) {
    throw new Error("Not authenticated");
  }

  const res = (await apiExecuteCommand(access, {
    sessionId: input.sessionId ?? undefined,
    command: input.command,
    contextType,
    actionSource,
    contextMetadata: input.contextMetadata,
    selectedText: input.selectedText ?? undefined,
  })) as ApiResponse<Record<string, unknown>>;

  if (!res.success) {
    throw new Error(res.message);
  }

  return { data: res.data as CommandResultPayload, usedRestFallback: true };
}

async function sendActionAckSafe(ack: Parameters<typeof rippleSocket.sendActionAck>[0]) {
  if (!rippleSocket.isConnected()) return;
  try {
    await rippleSocket.sendActionAck(ack);
  } catch {
    /* desktop-only command_id may not exist in DB */
  }
}

function trackActionUse(payload: CommandResultPayload): void {
  try {
    recordActionUse(primaryToolFromPayload(payload));
  } catch {
    /* optional */
  }
}

function plannerSourceForFastPath(command: string): PlannerSource {
  if (parseGraphOpenCommand(command)) return "graph";
  return "fast";
}

function recordExecutionTelemetry(
  command: string,
  payload: CommandResultPayload,
  execution: Awaited<ReturnType<typeof runCommandActions>> | undefined,
  planner_source: PlannerSource,
  extra?: { latency_ms?: number; detail?: string },
): void {
  if (!execution) return;
  const ok = execution.records.filter((r) => r.status === "executed").length;
  recordCommandEvent({
    command,
    outcome: ok > 0 ? "success" : "error",
    planner_source,
    intent: payload.intent,
    latency_ms: extra?.latency_ms,
    detail: extra?.detail,
  });
}

function rateLimited(payload: CommandResultPayload): string | null {
  return rateLimitForPayload(payload);
}

function isDesktopInputFallbackCandidate(
  command: string,
  payload: CommandResultPayload,
): boolean {
  if (payload.actions?.length !== 1) return false;
  if (payload.actions[0]?.type !== "SHOW_SUGGESTIONS") return false;
  if (
    payload.intent !== "typing" &&
    payload.intent !== "edit" &&
    payload.intent !== "undo" &&
    payload.intent !== "generation"
  ) {
    return false;
  }
  if (
    isWhatsAppTabActive() ||
    isGmailComposeFocused() ||
    isInstagramTabActive() ||
    isLinkedInTabActive() ||
    isYouTubeFocused() ||
    isNotionFocused()
  ) {
    return false;
  }
  return parseDesktopInputFallback(command) !== null;
}

function applyDesktopInputFallback(
  command: string,
  payload: CommandResultPayload,
): CommandResultPayload {
  const parsed = parseDesktopInputFallback(command);
  if (!parsed) return payload;
  const typing = buildTypingPayloadFromInput(command, parsed);
  return {
    ...typing,
    command_id: payload.command_id ?? typing.command_id,
  };
}

function buildDesktopInputPayload(command: string): CommandResultPayload | null {
  const normalized = normalizeDesktopVoiceCommand(command);
  const parsed =
    parseDesktopInputFallback(normalized) ?? parseDesktopInputFallback(command);
  if (!parsed) return null;
  return buildTypingPayloadFromInput(command, parsed);
}

function emitCompoundClarifyResult(
  command: string,
  effectiveCommand: string,
  gate: Extract<PlannerPipelineResult, { kind: "clarify" }>,
  world: Awaited<ReturnType<typeof buildWorldModel>>,
): RunCommandResult {
  beginClarificationRound({
    originalCommand: command,
    normalizedUtterance: effectiveCommand,
    question: gate.question,
    reason: gate.reason,
    plan: gate.plan,
    world,
  });
  showClarifyQuestionOnOverlay(gate.question);
  logConversationTurn(command, "rephrase");
  return { ok: false, message: gate.question };
}

function emitCompoundPartialResult(
  command: string,
  effectiveCommand: string,
  partial: Extract<PlannerPipelineResult, { kind: "partial" }>,
  world: Awaited<ReturnType<typeof buildWorldModel>>,
  detail: string,
  getAccessToken: () => Promise<string | null>,
): Promise<RunCommandResult> {
  return runCompoundPartialResult(command, effectiveCommand, partial, world, detail, getAccessToken);
}

async function runCompoundPartialResult(
  command: string,
  effectiveCommand: string,
  partial: Extract<PlannerPipelineResult, { kind: "partial" }>,
  world: Awaited<ReturnType<typeof buildWorldModel>>,
  detail: string,
  getAccessToken: () => Promise<string | null>,
): Promise<RunCommandResult> {
  logPhaseBSplit(partial);

  const outcome = await executeCompoundPartialPlan({
    partial,
    command,
    effectiveCommand,
    normalized: normalizeIntent(effectiveCommand),
    world,
    detail,
    getAccessToken,
    runPayload: (p) => runCommandActions(p, sendActionAckSafe),
  });

  if (outcome.kind === "clarify") {
    beginClarificationRound({
      originalCommand: command,
      normalizedUtterance: effectiveCommand,
      question: outcome.question,
      reason: outcome.reason,
      plan: partial.plan,
      world,
    });
    showClarifyQuestionOnOverlay(outcome.question);
    logConversationTurn(command, "rephrase");
    return { ok: false, message: outcome.question };
  }

  if (outcome.kind === "failed") {
    logConversationTurn(command, "not_found");
    return { ok: false, message: outcome.message };
  }

  if (outcome.payload) {
    setLastCommandIntent(outcome.payload.intent);
    recordExecutionTelemetry(command, outcome.payload, outcome.execution ?? null, "fast", {
      detail: `${detail}-phase-b-partial`,
    });
    logConversationTurn(command, "success", { intent: outcome.payload.intent });
    recordP85Execute();
    console.info(`[ripple-p85] phase-b complete: ${outcome.message}`);
    return {
      ok: true,
      message: outcome.message,
      data: { ...outcome.payload, execution: outcome.execution },
    };
  }

  logConversationTurn(command, "success");
  return { ok: true, message: outcome.message };
}

async function tryP85FastPath(
  command: string,
  detail: string,
  getAccessToken: () => Promise<string | null>,
): Promise<RunCommandResult | null> {
  const clarifyFollowUp = resolveClarificationFollowUp(command);
  const effectiveCommand = clarifyFollowUp?.mergedCommand ?? command;
  if (clarifyFollowUp && clarifyFollowUp.round > 2) {
    logConversationTurn(command, "not_found");
    return { ok: false, message: clarificationExhaustedMessage() };
  }

  const world = await buildWorldModel();
  const normalizedForGate = normalizeIntent(effectiveCommand);

  if (shouldBypassP85Planner(effectiveCommand)) {
    if (process.env.RIPPLE_P85_TRACE !== "0") {
      console.info(
        `[ripple-p85] bypass adapter-owned utterance norm="${normalizedForGate.slice(0, 80)}"`,
      );
    }
    return null;
  }

  if (phaseBStage1Enabled() && isCompoundUtterance(effectiveCommand, normalizedForGate)) {
    console.info(
      `[ripple-p85] phase-b compound entry norm="${normalizedForGate.slice(0, 80)}"`,
    );
  }

  const compoundGate = tryCompoundGate(effectiveCommand, normalizedForGate);
  if (compoundGate?.kind === "clarify") {
    return emitCompoundClarifyResult(command, effectiveCommand, compoundGate, world);
  }
  if (compoundGate?.kind === "partial") {
    return emitCompoundPartialResult(
      command,
      effectiveCommand,
      compoundGate,
      world,
      detail,
      getAccessToken,
    );
  }

  const pipeline = await runPlannerPipelineAsync({
    command: effectiveCommand,
    world,
    getAccessToken,
  });

  if (pipeline.kind === "partial") {
    return emitCompoundPartialResult(
      command,
      effectiveCommand,
      pipeline,
      world,
      detail,
      getAccessToken,
    );
  }

  if (pipeline.kind === "clarify") {
    beginClarificationRound({
      originalCommand: command,
      normalizedUtterance: effectiveCommand,
      question: pipeline.question,
      reason: pipeline.reason,
      plan: pipeline.plan,
      world,
    });
    showClarifyQuestionOnOverlay(pipeline.question);
    logConversationTurn(command, "rephrase");
    return { ok: false, message: pipeline.question };
  }

  if (
    pipeline.kind === "defer" &&
    pipeline.reason.startsWith("compound_") &&
    pipeline.reason !== "compound_legacy_fallthrough"
  ) {
    const message = compoundUnresolvedQuestion([]);
    showClarifyQuestionOnOverlay(message);
    logConversationTurn(command, "rephrase");
    return { ok: false, message };
  }

  if (pipeline.kind === "execute") {
    const built = buildExecutorPayload(pipeline.plan, command, world);
    if (built.kind === "invalid") {
      const blocked = built.errors.find((e) => e.startsWith("permission_blocked:"));
      if (blocked) {
        const message = blocked.replace(/^permission_blocked:/, "") || "Command blocked by policy.";
        logConversationTurn(command, "blocked");
        return { ok: false, message };
      }
      return null;
    }
    const payload =
      built.kind === "payload" || built.kind === "executor"
        ? built.payload
        : null;
    if (payload?.actions?.length && payload.command_id) {
      const source = pipeline.plan.source;
      const tools = pipeline.plan.steps.map((s) => s.tool).join(",");
      logPayloadBridgeDiagnostic(
        pipeline.plan,
        payload,
        built.kind === "executor" ? "executor" : "payload",
      );
      console.info(
        `[ripple-desktop] command:result intent=${payload.intent} actions=${payload.actions.length} id=${payload.command_id} (${detail}) p85:${source} tools=${tools}`,
      );
      setLastCommandIntent(payload.intent);

      const execResult = await runValidatedPlanExecution({
        plan: pipeline.plan,
        command: effectiveCommand,
        world,
        built,
        getAccessToken,
        runPayload: (p) => runCommandActions(p, sendActionAckSafe),
      });

      const execution = execResult.actionSummary ?? null;
      const recoveryOutcome = execResult.recovery;
      if (execResult.via === "executor") {
        console.info(
          `[ripple-p85] tool-executor route tools=${tools} id=${payload.command_id}`,
        );
      }
      if (recoveryOutcome?.recovered) {
        console.info(
          `[ripple-p85] recovery succeeded attempts=${recoveryOutcome.attempts}`,
        );
      }
      observeP85Execution({
        command: effectiveCommand,
        plan: pipeline.plan,
        payload,
        summary: execution,
        recovery: recoveryOutcome,
      });
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      recordExecutionTelemetry(command, payload, execution, "fast", { detail });
      logConversationTurn(command, "success", { intent: payload.intent });
      if (execResult.via !== "executor") {
        trackActionUse(payload);
      }
      recordP85Execute();
      runShadowParityOnExecute(effectiveCommand, pipeline.plan, payload);
      const m = getPlannerMetrics();
      if (m.total > 0 && m.total % 25 === 0) {
        console.info(formatPlannerMetricsLine());
        console.info(formatPlannerDashboardLine());
      }
      return { ok: true, data: { ...payload, execution } };
    }
  }

  const deferReason = pipeline.kind === "defer" ? pipeline.reason : "no_match";
  if (!shouldBlockLegacyDesktopRouters(effectiveCommand, normalizedForGate)) {
    logShadowLegacyDesktopRouters(command, deferReason);
  }

  return null;
}

async function tryDesktopInputFastPath(
  command: string,
  detail: string,
  opts?: { early?: boolean },
): Promise<RunCommandResult | null> {
  const allowed = opts?.early
    ? legacyDesktopEarlyInputEnabled()
    : legacyDesktopRoutersEnabled();
  if (!allowed) return null;

  const payload = buildDesktopInputPayload(command);
  if (!payload?.actions?.length || !payload.command_id) return null;

  console.info(
    `[ripple-desktop] command:result intent=typing actions=${payload.actions.length} id=${payload.command_id} (${detail})`,
  );
  setLastCommandIntent(payload.intent);
  const execution = await runCommandActions(payload, sendActionAckSafe);
  if (execution) {
    const ok = execution.records.filter((r) => r.status === "executed").length;
    console.info(
      `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
    );
  }
  recordExecutionTelemetry(
    command,
    payload,
    execution,
    "fast",
    { detail },
  );
  logConversationTurn(command, "success", { intent: payload.intent });
  trackActionUse(payload);
  return { ok: true, data: { ...payload, execution } };
}

async function tryLegacyDesktopFastPath(
  command: string,
  desktopFast: CommandResultPayload,
): Promise<RunCommandResult | null> {
  if (!legacyDesktopRoutersEnabled()) return null;
  if (shouldSkipFastPathForGpt(command)) return null;

  const permissionBlocked = getPermissionBlockMessage(command, desktopFast);
  if (permissionBlocked) {
    recordCommandEvent({
      command,
      outcome: "blocked",
      permission: "blocked",
      planner_source: plannerSourceForFastPath(command),
      detail: permissionBlocked.slice(0, 200),
    });
    logConversationTurn(command, "blocked");
    return { ok: false, message: permissionBlocked };
  }
  const limited = rateLimited(desktopFast);
  if (limited) {
    recordCommandEvent({
      command,
      outcome: "blocked",
      detail: "rate_limit",
    });
    return { ok: false, message: limited };
  }
  console.info(
    `[ripple-desktop] command:result intent=workflow actions=${desktopFast.actions?.length ?? 0} id=${desktopFast.command_id} (desktop-fast)`,
  );
  setLastCommandIntent(desktopFast.intent);
  const execution = await runCommandActions(desktopFast, sendActionAckSafe);
  if (execution) {
    const ok = execution.records.filter((r) => r.status === "executed").length;
    console.info(
      `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
    );
  }
  recordExecutionTelemetry(
    command,
    desktopFast,
    execution,
    plannerSourceForFastPath(command),
  );
  logConversationTurn(command, "success", { intent: desktopFast.intent });
  trackActionUse(desktopFast);
  return { ok: true, data: { ...desktopFast, execution } };
}

function logShadowLegacyDesktopRouters(
  command: string,
  reason: string,
): void {
  const legacyInput = buildDesktopInputPayload(command);
  if (legacyInput) {
    logPlannerRouterMismatch(command, reason, "desktop-input", legacyInput);
  }
  const legacyDesktop = buildDesktopCommandResult(command);
  if (legacyDesktop?.actions?.length) {
    logPlannerRouterMismatch(command, reason, "desktop-fast", legacyDesktop);
  }
}

async function shouldUniversalOverrideBackend(
  command: string,
  payload: CommandResultPayload,
): Promise<boolean> {
  if (isDesktopInputFallbackCandidate(command, payload)) return true;
  const firstAction = payload.actions?.[0];
  if (
    payload.intent === "typing" &&
    (firstAction?.type === "NOOP" || firstAction?.type === "SHOW_SUGGESTIONS")
  ) {
    if (parseDesktopInputFallback(command)) return true;
  }
  if (payload.intent !== "generation" && payload.intent !== "undo") {
    if (payload.intent !== "typing") return false;
  }
  const world = await buildWorldModel();
  const plan = planUniversalIntent(command, world);
  return plan.kind === "execute" && plan.confidence >= 0.7;
}

async function tryExecuteUniversalDesktopPlan(
  command: string,
  detail: string,
): Promise<RunCommandResult | null> {
  const world = await buildWorldModel();
  const universal = planUniversalIntent(command, world);
  if (universal.kind === "clarify") {
    showClarifyQuestionOnOverlay(universal.question);
    logConversationTurn(command, "rephrase");
    return { ok: false, message: universal.question };
  }
  if (universal.kind !== "execute" || universal.confidence < 0.7) {
    return null;
  }
  const universalPayload = universalPlanToCommandPayload(universal, command);
  if (!universalPayload?.actions?.length || !universalPayload.command_id) {
    return null;
  }
  console.info(
    `[ripple-desktop] command:result intent=${universalPayload.intent} tool=${universal.tool} conf=${universal.confidence} (${universal.reason})`,
  );
  setLastCommandIntent(universalPayload.intent);
  const execution = await runCommandActions(universalPayload, sendActionAckSafe);
  if (execution) {
    const ok = execution.records.filter((r) => r.status === "executed").length;
    console.info(
      `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
    );
  }
  recordExecutionTelemetry(command, universalPayload, execution, "fast", {
    detail: `${detail}:${universal.reason}`,
  });
  logConversationTurn(command, "success", { intent: universalPayload.intent });
  trackActionUse(universalPayload);
  return { ok: true, data: { ...universalPayload, execution } };
}

async function tryYouTubeLocal(
  input: RunCommandInput,
): Promise<CommandResultPayload | null> {
  const normalized = normalizeTranscript(input.command);
  const repaired = repairCorruptedTranscript(input.command);

  if (isLikelyYouTubeSearchCommand(normalized) || isLikelyYouTubeSearchCommand(repaired)) {
    const access = await input.getAccessToken();
    if (access) {
      const forLlm =
        repaired !== normalized && repaired.length > 2
          ? `${repaired}\n(raw transcript: ${input.command.trim()})`
          : normalized;
      const llm = await fetchYouTubeSearchQueryFromLlm(access, forLlm);
      if (llm?.query) {
        return buildYouTubeCommandFromPlan(llm, input.command);
      }
    }
  }

  return (
    buildYouTubeCommandResult(normalized) ??
    buildYouTubeCommandResult(repaired)
  );
}

function tryLinkedInLocal(command: string): CommandResultPayload | null {
  return (
    buildLinkedInCommandResult(command) ??
    buildLinkedInCommandResult(repairCorruptedTranscript(command))
  );
}

function shouldRouteToBackendFirst(input: RunCommandInput): boolean {
  if (isGmailComposeFocused()) return true;
  if (isLinkedInTabActive()) {
    if (isLinkedInCommand(input.command)) return true;
    if (isContextualLinkedInVoiceCommand(input.command)) return true;
    if (isRegionalLanguageCommand(input.command)) return true;
    if (looksLikeBoxDrawingMojibake(input.command)) return true;
  }
  if (isYouTubeFocused()) {
    if (isYouTubeCommand(input.command)) return true;
    if (isContextualYouTubeVoiceCommand(input.command)) return true;
    if (isRegionalLanguageCommand(input.command)) return true;
    if (looksLikeBoxDrawingMojibake(input.command)) return true;
  }
  if (isWhatsAppTabActive()) {
    if (isEditOrRephraseCommand(input.command)) return true;
    if (isRegionalLanguageCommand(input.command)) return true;
  }
  if (isInstagramTabActive() && isEditOrRephraseCommand(input.command)) {
    return true;
  }
  return false;
}

async function runBackendCommandFlow(
  input: RunCommandInput,
): Promise<RunCommandResult> {
  let { data, usedRestFallback } = await fetchCommandResult(input);

  const notionOverride = applyNotionVoiceOverride(input.command, data);
  if (notionOverride) {
    data = notionOverride;
  }

  const youtubeOverride = applyYouTubeVoiceOverride(input.command, data);
  if (youtubeOverride) {
    data = youtubeOverride;
  }

  const waOverride = applyWhatsAppVoiceOverride(input.command, data);
  if (waOverride) {
    data = waOverride;
  }

  const waRephrase = applyWhatsAppRephraseOverride(input.command, data);
  if (waRephrase) {
    data = waRephrase;
  }

  const linkedinOverride = applyLinkedInVoiceOverride(input.command, data);
  if (linkedinOverride) {
    data = linkedinOverride;
  }

  const instagramOverride = applyInstagramVoiceOverride(input.command, data);
  if (instagramOverride) {
    data = instagramOverride;
  }

  if (isDesktopInputFallbackCandidate(input.command, data)) {
    data = applyDesktopInputFallback(input.command, data);
    console.info(
      "[ripple-desktop] desktop input fallback: SHOW_SUGGESTIONS -> INSERT_TEXT",
    );
  }

  const universalOverride =
    (await shouldUniversalOverrideBackend(input.command, data))
      ? await tryExecuteUniversalDesktopPlan(
          input.command,
          "backend_universal_override",
        )
      : null;
  if (universalOverride) {
    return universalOverride;
  }

  if (
    data.actions?.length === 1 &&
    data.actions[0]?.type === "NOOP" &&
    parseDesktopInputFallback(input.command)
  ) {
    const localOverride = await tryExecuteUniversalDesktopPlan(
      input.command,
      "noop_desktop_override",
    );
    if (localOverride) {
      return localOverride;
    }
  }

  console.info(
    `[ripple-desktop] command:result intent=${data.intent} actions=${data.actions?.length ?? 0} id=${data.command_id}${usedRestFallback ? " (REST)" : ""}`,
  );
  setLastCommandIntent(data.intent);

  let execution = null;
  if (data.actions?.length && data.command_id) {
    console.info(
      `[ripple-desktop] running ${data.actions.length} action(s): ${data.actions.map((a) => a.type).join(", ")}`,
    );
    execution = await runCommandActions(data, sendActionAckSafe);
    if (execution) {
      const ok = execution.records.filter((r) => r.status === "executed").length;
      console.info(
        `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
      );
    }
  }

  logConversationTurn(input.command, "success", { intent: data.intent });
  return {
    ok: true,
    data: { ...data, execution },
    usedRestFallback,
  };
}

export async function runDesktopCommand(
  input: RunCommandInput,
): Promise<RunCommandResult> {
  try {
    clearPreprocessCache();

    const undoIntent =
      parseUndoCommand(input.command) ??
      parseUndoCommand(repairCorruptedTranscript(input.command));
    if (undoIntent) {
      const undoPayload = commandPayloadFromIntent(
        undoIntent,
        input.command.trim(),
        " (undo)",
      );
      console.info(
        `[ripple-desktop] command:result intent=workflow (undo) id=${undoPayload.command_id}`,
      );
      setLastCommandIntent(undoPayload.intent);
      const execution = await runCommandActions(undoPayload, sendActionAckSafe);
      recordExecutionTelemetry(
        input.command,
        undoPayload,
        execution,
        "fast",
        { detail: "undo" },
      );
      logConversationTurn(input.command, "success", { intent: undoPayload.intent });
      return { ok: true, data: { ...undoPayload, execution } };
    }

    const goalControl = parseGoalControlCommand(input.command);
    if (goalControl === "cancel") {
      completeGoal("cancelled");
      return { ok: true, message: "Goal cancelled." };
    }
    if (goalControl === "pause") {
      pauseGoal();
      return { ok: true, message: "Goal paused. Say continue goal to resume." };
    }
    if (goalControl === "continue") {
      const goal = getActiveGoal();
      if (!goal) {
        return { ok: false, message: "No active goal to continue." };
      }
      updateGoal({ status: "active" });
      return {
        ok: true,
        message: `Continuing goal: ${goal.summary}`,
      };
    }

    const referentialWa = buildReferentialWhatsAppResult(input.command);
    if (referentialWa?.actions?.length && referentialWa.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow (referential-whatsapp) id=${referentialWa.command_id}`,
      );
      setLastCommandIntent(referentialWa.intent);
      const execution = await runCommandActions(referentialWa, sendActionAckSafe);
      recordExecutionTelemetry(
        input.command,
        referentialWa,
        execution,
        "fast",
        { detail: "referential_whatsapp" },
      );
      logConversationTurn(input.command, "success", { intent: referentialWa.intent });
      return { ok: true, data: { ...referentialWa, execution } };
    }

    const linkedinEarly = tryLinkedInLocal(input.command);
    if (linkedinEarly?.actions?.length && linkedinEarly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${linkedinEarly.actions.length} id=${linkedinEarly.command_id} (linkedin-local)`,
      );
      setLastCommandIntent(linkedinEarly.intent);
      const execution = await runCommandActions(linkedinEarly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      recordExecutionTelemetry(
        input.command,
        linkedinEarly,
        execution,
        "fast",
        { detail: "linkedin-local" },
      );
      return { ok: true, data: { ...linkedinEarly, execution } };
    }

    if (p85DesktopEntryEnabled()) {
      const p85Early = await tryP85FastPath(
        input.command,
        "p85-desktop-early",
        input.getAccessToken,
      );
      if (p85Early) {
        return p85Early;
      }
    } else {
      console.info("[ripple-p85] kill-switch — using legacy desktop routers only");
    }

    if (legacyDesktopEarlyInputEnabled()) {
      const desktopInputEarly = await tryDesktopInputFastPath(
        input.command,
        "desktop-input-early",
        { early: true },
      );
      if (desktopInputEarly) {
        return desktopInputEarly;
      }
    }

    if (
      isWhatsAppTabActive() &&
      !isLikelyDesktopCommand(input.command) &&
      !isDesktopAppForeground() &&
      !parseDesktopInputFallback(input.command)
    ) {
      const waEarly =
        buildWhatsAppCommandResult(input.command) ??
        buildWhatsAppCommandResult(repairCorruptedTranscript(input.command));
      if (waEarly?.actions?.length && waEarly.command_id) {
        console.info(
          `[ripple-desktop] command:result intent=workflow actions=${waEarly.actions.length} id=${waEarly.command_id} (whatsapp-early)`,
        );
        setLastCommandIntent(waEarly.intent);
        const execution = await runCommandActions(waEarly, sendActionAckSafe);
        if (execution) {
          const ok = execution.records.filter((r) => r.status === "executed").length;
          console.info(
            `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
          );
        }
        logConversationTurn(input.command, "success", { intent: waEarly.intent });
        recordExecutionTelemetry(
          input.command,
          waEarly,
          execution,
          "fast",
          { detail: "whatsapp-early" },
        );
        return { ok: true, data: { ...waEarly, execution } };
      }
    }

    if (/\bwhatsapp\b/i.test(input.command)) {
      const waMention =
        buildWhatsAppCommandResult(input.command) ??
        buildWhatsAppCommandResult(repairCorruptedTranscript(input.command));
      if (waMention?.actions?.length && waMention.command_id) {
        console.info(
          `[ripple-desktop] command:result intent=workflow actions=${waMention.actions.length} id=${waMention.command_id} (whatsapp-mention)`,
        );
        setLastCommandIntent(waMention.intent);
        const execution = await runCommandActions(waMention, sendActionAckSafe);
        if (execution) {
          const ok = execution.records.filter((r) => r.status === "executed").length;
          console.info(
            `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
          );
        }
        logConversationTurn(input.command, "success", { intent: waMention.intent });
        recordExecutionTelemetry(
          input.command,
          waMention,
          execution,
          "fast",
          { detail: "whatsapp-mention" },
        );
        return { ok: true, data: { ...waMention, execution } };
      }
    }

    const cmdNorm = normalizeTranscript(input.command);
    const isWorkflowTeach =
      /^\s*(?:remember|replace)\s+/i.test(cmdNorm) &&
      (Boolean(parseWorkflowMetaCommand(cmdNorm)) ||
        isRememberWorkflowPhrase(cmdNorm));

    if (!isWorkflowTeach && !shouldBlockLegacyDesktopRouters(input.command, cmdNorm)) {
      const youtubeEarly = await tryYouTubeLocal(input);
      if (youtubeEarly?.actions?.length && youtubeEarly.command_id) {
        console.info(
          `[ripple-desktop] command:result intent=workflow actions=${youtubeEarly.actions.length} id=${youtubeEarly.command_id} (youtube-local)`,
        );
        setLastCommandIntent(youtubeEarly.intent);
        const execution = await runCommandActions(youtubeEarly, sendActionAckSafe);
        if (execution) {
          const ok = execution.records.filter((r) => r.status === "executed").length;
          console.info(
            `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
          );
        }
        recordExecutionTelemetry(
          input.command,
          youtubeEarly,
          execution,
          "fast",
          { detail: "youtube-local" },
        );
        return { ok: true, data: { ...youtubeEarly, execution } };
      }
    }

    const normForCompound = normalizeIntent(input.command);
    const compoundLegacyGate = tryCompoundGate(input.command, normForCompound);
    if (compoundLegacyGate?.kind === "clarify") {
      const worldForClarify = await buildWorldModel();
      return emitCompoundClarifyResult(
        input.command,
        input.command,
        compoundLegacyGate,
        worldForClarify,
      );
    }
    if (compoundLegacyGate?.kind === "partial") {
      const worldForPartial = await buildWorldModel();
      return emitCompoundPartialResult(
        input.command,
        input.command,
        compoundLegacyGate,
        worldForPartial,
        "p85-compound-legacy",
        input.getAccessToken,
      );
    }

    const desktopFast = buildDesktopCommandResult(input.command);
    const world = await buildWorldModel();
    console.info(`[ripple-desktop] world model: ${summarizeWorldForLog(world)}`);

    const desktopInputFast = buildDesktopInputPayload(input.command);

    if (shouldTryAgentCompound(input.command)) {
      const useLegacyAgentCompound = legacyAgentCompoundEnabled();
      const agentCompound = tryAgentCompoundCommand(input.command);
      const p85WouldHandle = tryL0CompoundPlan(
        input.command,
        normalizeIntent(input.command),
      );

      if (
        agentCompound?.actions?.length &&
        agentCompound.command_id &&
        !useLegacyAgentCompound &&
        p85WouldHandle
      ) {
        logPlannerRouterMismatch(
          input.command,
          "p85_l0_compound",
          "agent-compound",
          agentCompound,
        );
      } else if (
        agentCompound?.actions?.length &&
        agentCompound.command_id &&
        (useLegacyAgentCompound || !p85WouldHandle)
      ) {
        console.info(
          `[ripple-desktop] command:result intent=workflow actions=${agentCompound.actions.length} id=${agentCompound.command_id} (agent-compound)`,
        );
        setLastCommandIntent(agentCompound.intent);
        const execution = await runCommandActions(agentCompound, sendActionAckSafe);
        if (execution) {
          const ok = execution.records.filter((r) => r.status === "executed").length;
          console.info(
            `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
          );
        }
        recordExecutionTelemetry(
          input.command,
          agentCompound,
          execution,
          "fast",
          { detail: "agent-compound" },
        );
        logConversationTurn(input.command, "success", {
          intent: agentCompound.intent,
        });
        if (!getActiveGoal()) {
          startGoal(input.command.trim(), agentCompound.actions.length);
        } else {
          updateGoal({ stepIndex: (getActiveGoal()?.stepIndex ?? 0) + 1 });
        }
        trackActionUse(agentCompound);
        return { ok: true, data: { ...agentCompound, execution } };
      }
    }

    if (desktopInputFast?.actions?.length && desktopInputFast.command_id) {
      if (legacyDesktopRoutersEnabled()) {
        const desktopInputResult = await tryDesktopInputFastPath(
          input.command,
          "desktop-input-fast",
        );
        if (desktopInputResult) {
          return desktopInputResult;
        }
      }
    }

    if (desktopFast?.actions?.length && desktopFast.command_id) {
      if (
        legacyDesktopRoutersEnabled() &&
        !shouldBlockLegacyDesktopRouters(input.command, cmdNorm)
      ) {
        const legacyFast = await tryLegacyDesktopFastPath(
          input.command,
          desktopFast,
        );
        if (legacyFast) return legacyFast;
      }
    }

    const whatsappOnly = buildWhatsAppCommandResult(input.command);
    if (whatsappOnly?.actions?.length && whatsappOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${whatsappOnly.actions.length} id=${whatsappOnly.command_id} (whatsapp-local)`,
      );
      setLastCommandIntent(whatsappOnly.intent);
      const execution = await runCommandActions(whatsappOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      recordExecutionTelemetry(
        input.command,
        whatsappOnly,
        execution,
        "fast",
        { detail: "whatsapp-local" },
      );
      return { ok: true, data: { ...whatsappOnly, execution } };
    }

    if (shouldRouteToBackendFirst(input)) {
      console.info(
        "[ripple-desktop] web-app compose — backend-first (skip desktop planner)",
      );
      return runBackendCommandFlow(input);
    }

    const planStarted = Date.now();
    const useLegacyPlanDesktop = legacyPlanDesktopEnabled();
    const planned = useLegacyPlanDesktop
      ? await planDesktopCommand(input.command, input.getAccessToken)
      : null;
    const planLatencyMs = Date.now() - planStarted;

    if (!planned) {
      if (shouldRouteToBackendFirst(input)) {
        return runBackendCommandFlow(input);
      }
      if (
        isLikelyDesktopCommand(input.command) ||
        isRegionalLanguageCommand(input.command)
      ) {
        const message = guidedNotFound(input.command);
        recordCommandEvent({
          command: input.command,
          outcome: "not_found",
          planner_source: useLegacyPlanDesktop ? "offline" : "p85",
          detail: useLegacyPlanDesktop ? "plan_null" : "p85_exhausted",
          latency_ms: planLatencyMs,
        });
        logConversationTurn(input.command, "not_found");
        return { ok: false, message };
      }
    }

    if (planned?.kind === "payload") {
      const limited = rateLimited(planned.payload);
      if (limited) {
        recordCommandEvent({
          command: input.command,
          outcome: "blocked",
          detail: "rate_limit",
          latency_ms: planLatencyMs,
        });
        return { ok: false, message: limited };
      }
      const desktopOnly = planned.payload;
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${desktopOnly.actions?.length ?? 0} id=${desktopOnly.command_id} (desktop-${planned.source})`,
      );
      setLastCommandIntent(desktopOnly.intent);
      const execution = await runCommandActions(desktopOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
        recordCommandEvent({
          command: input.command,
          outcome: ok > 0 ? "success" : "error",
          planner_source: planned.source,
          confidence: planned.confidence,
          intent: desktopOnly.intent,
          latency_ms: planLatencyMs,
        });
      }
      logConversationTurn(input.command, "success", {
        intent: desktopOnly.intent,
      });
      trackActionUse(desktopOnly);
      return { ok: true, data: { ...desktopOnly, execution } };
    }

    if (
      planned?.kind === "blocked" ||
      planned?.kind === "rephrase" ||
      planned?.kind === "not_found"
    ) {
      const message =
        planned.kind === "blocked" ? planned.message : planned.hint;
      const outcome =
        planned.kind === "blocked"
          ? "blocked"
          : planned.kind === "not_found"
            ? "not_found"
            : "rephrase";
      if (planned.kind === "not_found" && shouldRouteToBackendFirst(input)) {
        return runBackendCommandFlow(input);
      }
      recordCommandEvent({
        command: input.command,
        outcome,
        planner_source: planned.kind === "not_found" ? "gpt" : "offline",
        detail: planned.kind,
        latency_ms: planLatencyMs,
      });
      console.warn(`[ripple-desktop] desktop plan ${planned.kind}: ${message}`);
      logConversationTurn(input.command, outcome);
      return { ok: false, message };
    }

    if (planned?.kind === "clarify") {
      if (planned.candidates.length > 0) {
        const paths = planned.candidates.map((c) => c.path);
        const picked = await pickItemFromMatches(
          planned.question,
          paths,
        );
        if (picked) {
          recordFileTouch({
            path: picked,
            command: input.command,
            source: "clarify",
          });
          const key = input.command.match(/\bopen\s+(?:my\s+|the\s+)?(.+?)\s*$/i)?.[1]
            ?.trim()
            .toLowerCase();
          if (key) {
            setCapabilityCacheEntry(key, picked, 0.95);
            recordTrustSignal(key, "clarify");
            boostEntityFromOpen(key, picked);
            confirmEntity(key);
          }
          const payload = commandPayloadFromResolvedPath(
            input.command,
            picked,
            " (clarify)",
          );
          setLastCommandIntent(payload.intent);
          const execution = await runCommandActions(payload, sendActionAckSafe);
          recordCommandEvent({
            command: input.command,
            outcome: "success",
            planner_source: "offline",
            confidence: planned.confidence,
            intent: payload.intent,
            latency_ms: planLatencyMs,
          });
          trackActionUse(payload);
          return { ok: true, data: { ...payload, execution } };
        }
        recordCommandEvent({
          command: input.command,
          outcome: "cancel",
          detail: "clarify_dismissed",
          latency_ms: planLatencyMs,
        });
        return { ok: false, message: "Cancelled — pick which file you meant" };
      }
      recordCommandEvent({
        command: input.command,
        outcome: "clarify",
        planner_source: "offline",
        latency_ms: planLatencyMs,
        detail: "clarify_pending",
      });
      return {
        ok: false,
        message: planned.question,
      };
    }

    const notionOnly = buildNotionCommandResult(input.command);
    if (notionOnly?.actions?.length && notionOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${notionOnly.actions.length} id=${notionOnly.command_id} (notion-local)`,
      );
      setLastCommandIntent(notionOnly.intent);
      const execution = await runCommandActions(notionOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      recordExecutionTelemetry(
        input.command,
        notionOnly,
        execution,
        "fast",
        { detail: "notion-local" },
      );
      return { ok: true, data: { ...notionOnly, execution } };
    }

    const youtubeOnly = shouldBlockLegacyDesktopRouters(input.command, cmdNorm)
      ? null
      : await tryYouTubeLocal(input);
    if (youtubeOnly?.actions?.length && youtubeOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${youtubeOnly.actions.length} id=${youtubeOnly.command_id} (youtube-local)`,
      );
      setLastCommandIntent(youtubeOnly.intent);
      const execution = await runCommandActions(youtubeOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      recordExecutionTelemetry(
        input.command,
        youtubeOnly,
        execution,
        "fast",
        { detail: "youtube-local" },
      );
      return { ok: true, data: { ...youtubeOnly, execution } };
    }

    const linkedinOnly = tryLinkedInLocal(input.command);
    if (linkedinOnly?.actions?.length && linkedinOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${linkedinOnly.actions.length} id=${linkedinOnly.command_id} (linkedin-local)`,
      );
      setLastCommandIntent(linkedinOnly.intent);
      const execution = await runCommandActions(linkedinOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      recordExecutionTelemetry(
        input.command,
        linkedinOnly,
        execution,
        "fast",
        { detail: "linkedin-local" },
      );
      return { ok: true, data: { ...linkedinOnly, execution } };
    }

    const igRephrase =
      isInstagramTabActive() && isEditOrRephraseCommand(input.command);
    const instagramOnly = igRephrase
      ? null
      : buildInstagramCommandResult(input.command);
    if (instagramOnly?.actions?.length && instagramOnly.command_id) {
      console.info(
        `[ripple-desktop] command:result intent=workflow actions=${instagramOnly.actions.length} id=${instagramOnly.command_id} (instagram-local)`,
      );
      setLastCommandIntent(instagramOnly.intent);
      const execution = await runCommandActions(instagramOnly, sendActionAckSafe);
      if (execution) {
        const ok = execution.records.filter((r) => r.status === "executed").length;
        console.info(
          `[ripple-desktop] actions done: ${ok}/${execution.records.length} succeeded`,
        );
      }
      recordExecutionTelemetry(
        input.command,
        instagramOnly,
        execution,
        "fast",
        { detail: "instagram-local" },
      );
      return { ok: true, data: { ...instagramOnly, execution } };
    }

    return runBackendCommandFlow(input);
  } catch (e: unknown) {
    if (e instanceof PermissionBlockedError) {
      recordCommandEvent({
        command: input.command,
        outcome: "blocked",
        permission: "blocked",
        detail: e.message.slice(0, 200),
      });
      logConversationTurn(input.command, "blocked");
      return { ok: false, message: e.message };
    }
    recordCommandEvent({
      command: input.command,
      outcome: "error",
      detail: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    });
    logConversationTurn(input.command, "error");
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Command failed",
    };
  }
}
