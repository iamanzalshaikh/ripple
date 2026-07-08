import type { PlannerPipelineInput, PlannerPipelineResult, ExecutionPlan } from "./planTypes.js";
import { normalizeIntent } from "./intentNormalizer.js";
import { runL0Planner } from "./l0Planner.js";
import { passesConfidenceGate, validatePlan } from "./planValidator.js";
import { shadowFromPipelineResult } from "./planLogger.js";
import { shouldTryGptFallback, shouldBypassP85Planner } from "./gptFallbackPolicy.js";
import { tryGptPlannerFallback } from "./gptPlannerBridge.js";
import { tryGroundedPlannerResult } from "./groundedPlannerBridge.js";
import { lookupCachedPlan } from "./planCache.js";
import { evaluatePlanConfidence } from "./confidenceEngine.js";
import { stampExecutionPlan } from "./planStamping.js";
import { tryResolveLaunchIntent } from "./entityResolver.js";
import { getCapabilitySnapshot } from "./capabilityService.js";
import { ensureP85ToolsRegistered } from "./toolExecutorBridge.js";
import { tracePipelineTier } from "./plannerTrace.js";
import { tryCompoundGate } from "./compoundGate.js";
import { tryL0WhatsAppPlan } from "./l0WhatsAppPlanner.js";
import { tryL0YouTubePlan } from "./l0YouTubePlanner.js";
import { tryL0GmailPlan } from "./l0GmailPlanner.js";
import { tryL0LinkedInPlan } from "./l0LinkedInPlanner.js";
import type { L0PlannerResult } from "./planTypes.js";

function isCompoundDeferReason(reason: string): boolean {
  return reason.startsWith("compound_");
}

function applyDedicatedL0Plan(
  l0: L0PlannerResult | null | undefined,
  raw: string,
  normalized: string,
  world: PlannerPipelineInput["world"],
  started: number,
): PlannerPipelineResult | null {
  if (!l0) return null;
  if (l0.kind === "defer") {
    const result: PlannerPipelineResult = {
      kind: "defer",
      reason: l0.reason,
      normalizedUtterance: normalized,
    };
    shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
    return result;
  }
  if (l0.kind !== "plan") return null;

  const validation = validatePlan(l0.plan, world, raw);
  if (!validation.valid) return null;
  const plan = validation.sanitizedPlan ?? l0.plan;
  if (!passesConfidenceGate(plan)) {
    const decision = evaluatePlanConfidence(plan);
    const result: PlannerPipelineResult = {
      kind: "clarify",
      question:
        plan.clarificationQuestion ??
        "I'm not sure what you meant. Can you say that again more specifically?",
      confidence: plan.confidence,
      reason: decision.action === "clarify" ? decision.reason : "low_confidence",
      plan,
    };
    shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
    return result;
  }
  const result: PlannerPipelineResult = {
    kind: "execute",
    plan: stampExecutionPlan(plan, world),
    validation,
  };
  shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
  return result;
}

/**
 * P8.5 Wave 1 pipeline: normalize → world (caller) → L0 → validate → execute/defer.
 */
export function runPlannerPipeline(
  input: PlannerPipelineInput,
): PlannerPipelineResult {
  ensureP85ToolsRegistered();
  const started = Date.now();
  const raw = input.command.trim();
  const normalized = normalizeIntent(raw);

  if (shouldBypassP85Planner(raw)) {
    const result: PlannerPipelineResult = {
      kind: "defer",
      reason: "adapter_owned",
      normalizedUtterance: normalized,
    };
    shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
    return result;
  }

  const earlyL0 =
    applyDedicatedL0Plan(tryL0WhatsAppPlan(raw, normalized), raw, normalized, input.world, started) ??
    applyDedicatedL0Plan(tryL0YouTubePlan(raw, normalized), raw, normalized, input.world, started) ??
    applyDedicatedL0Plan(tryL0GmailPlan(raw, normalized), raw, normalized, input.world, started) ??
    applyDedicatedL0Plan(tryL0LinkedInPlan(raw, normalized), raw, normalized, input.world, started);
  if (earlyL0) return earlyL0;

  const compoundGate = tryCompoundGate(raw, normalized);
  if (compoundGate) {
    tracePipelineTier("compound_gate", compoundGate.reason);
    shadowFromPipelineResult(raw, normalized, compoundGate, Date.now() - started);
    return compoundGate;
  }

  const l0 = runL0Planner(raw, normalized, input.world);
  tracePipelineTier("sync", l0.kind);

  if (l0.kind === "partial") {
    const result: PlannerPipelineResult = {
      kind: "partial",
      plan: l0.plan,
      unresolvedClauses: l0.unresolvedClauses,
      splitPreview: l0.splitPreview,
      question: l0.question,
      confidence: l0.confidence,
      reason: l0.reason,
    };
    shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
    return result;
  }

  if (l0.kind === "clarify") {
    const result: PlannerPipelineResult = {
      kind: "clarify",
      question: l0.question,
      options: l0.options,
      confidence: l0.confidence,
      reason: l0.reason,
    };
    shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
    return result;
  }

  if (l0.kind === "defer") {
    const result: PlannerPipelineResult = {
      kind: "defer",
      reason: l0.reason,
      normalizedUtterance: normalized,
    };
    shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
    return result;
  }

  const validation = validatePlan(l0.plan, input.world, raw);
  if (!validation.valid) {
    const result: PlannerPipelineResult = {
      kind: "defer",
      reason: `validation_failed:${validation.errors.join(",")}`,
      normalizedUtterance: normalized,
    };
    shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
    return result;
  }

  if (!passesConfidenceGate(l0.plan)) {
    const decision = evaluatePlanConfidence(l0.plan);
    const result: PlannerPipelineResult = {
      kind: "clarify",
      question:
        l0.plan.clarificationQuestion ??
        "I'm not sure what you meant. Can you say that again more specifically?",
      confidence: l0.plan.confidence,
      reason: decision.action === "clarify" ? decision.reason : "low_confidence",
      plan: l0.plan,
    };
    shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
    return result;
  }

  const result: PlannerPipelineResult = {
    kind: "execute",
    plan: stampExecutionPlan(validation.sanitizedPlan ?? l0.plan, input.world),
    validation,
  };
  shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
  return result;
}

function pipelineExecuteFromCachedPlan(
  raw: string,
  normalized: string,
  world: PlannerPipelineInput["world"],
  cached: ExecutionPlan | null,
  started: number,
): PlannerPipelineResult | null {
  if (!cached) return null;
  const validation = validatePlan(cached, world, raw);
  if (!validation.valid) return null;
  const plan = validation.sanitizedPlan ?? cached;
  if (!passesConfidenceGate(plan)) return null;
  const result: PlannerPipelineResult = {
    kind: "execute",
    plan: stampExecutionPlan(plan, world),
    validation,
  };
  shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
  return result;
}

/** L0 → cache → grounded → GPT fallback for desktop candidates. */
export async function runPlannerPipelineAsync(
  input: PlannerPipelineInput & {
    getAccessToken?: () => Promise<string | null>;
  },
): Promise<PlannerPipelineResult> {
  const sync = runPlannerPipeline(input);
  if (sync.kind !== "defer" || !input.getAccessToken) return sync;

  const raw = input.command.trim();
  const normalized = sync.normalizedUtterance;

  if (isCompoundDeferReason(sync.reason)) {
    tracePipelineTier("compound_gate", sync.reason);
    return sync;
  }

  const cacheStarted = Date.now();
  const cached = lookupCachedPlan(normalized, input.world);
  const cachedResult = pipelineExecuteFromCachedPlan(
    raw,
    normalized,
    input.world,
    cached,
    Date.now() - cacheStarted,
  );
  if (cachedResult) {
    tracePipelineTier("cache");
    return cachedResult;
  }

  void getCapabilitySnapshot(input.world);

  if (sync.reason === "no_l0_match") {
    const entityPlan = tryEntityResolverPlan(
      raw,
      sync.normalizedUtterance,
      input.world,
    );
    if (entityPlan) {
      tracePipelineTier("entity");
      return entityPlan;
    }
  }

  if (
    sync.reason === "no_l0_match" &&
    !shouldTryGptFallback(sync.reason, raw)
  ) {
    return sync;
  }

  if (sync.reason === "no_l0_match") {
    const grounded = await tryGroundedPlannerResult(raw);
    if (grounded?.kind === "clarify") {
      const started = Date.now();
      const result: PlannerPipelineResult = {
        kind: "clarify",
        question: grounded.question,
        options: grounded.options,
        confidence: 0.85,
        reason: "grounded_clarify",
      };
      shadowFromPipelineResult(raw, sync.normalizedUtterance, result, Date.now() - started);
      return result;
    }
    if (grounded?.kind === "payload" && grounded.payload.actions?.length && grounded.payload.command_id) {
      const started = Date.now();
      const result: PlannerPipelineResult = {
        kind: "execute",
        plan: {
          goal: "Grounded desktop",
          confidence: 0.92,
          steps: [
            {
              tool: "desktop.launch_app",
              args: { _desktopPayload: grounded.payload },
              reason: "grounded_lookup",
            },
          ],
          rawUtterance: raw,
          normalizedUtterance: sync.normalizedUtterance,
          source: "L0",
        },
        validation: { valid: true, errors: [] },
      };
      shadowFromPipelineResult(raw, sync.normalizedUtterance, result, Date.now() - started);
      return result;
    }
  }

  if (!shouldTryGptFallback(sync.reason, raw)) return sync;
  tracePipelineTier("gpt", sync.reason);
  return tryGptPlannerFallback({
    command: input.command,
    normalized: sync.normalizedUtterance,
    world: input.world,
    deferReason: sync.reason,
    getAccessToken: input.getAccessToken,
  });
}

function tryEntityResolverPlan(
  raw: string,
  normalized: string,
  world: PlannerPipelineInput["world"],
): PlannerPipelineResult | null {
  const started = Date.now();
  const launch = tryResolveLaunchIntent(raw);
  if (!launch || launch.kind !== "launch_app") return null;

  const draft: ExecutionPlan = stampExecutionPlan(
    {
      goal: `Open ${launch.app.id}`,
      confidence: 0.88,
      steps: [
        {
          tool: "desktop.launch_app",
          args: { app: launch.app.id, _nativeIntent: launch },
          reason: "entity_resolver",
        },
      ],
      rawUtterance: raw,
      normalizedUtterance: normalized,
      source: "L0",
    },
    world,
  );

  const validation = validatePlan(draft, world, raw);
  if (!validation.valid) return null;
  const plan = stampExecutionPlan(validation.sanitizedPlan ?? draft, world);
  if (!passesConfidenceGate(plan)) return null;

  const result: PlannerPipelineResult = {
    kind: "execute",
    plan,
    validation,
  };
  shadowFromPipelineResult(raw, normalized, result, Date.now() - started);
  return result;
}
