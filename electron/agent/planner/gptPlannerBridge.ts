import type { WorldModel } from "../types.js";
import { fetchDesktopIntentFromLlm } from "../../automation/voice/nlu/llmIntent.js";
import { policyFor } from "../../automation/voice/nlu/confidencePolicy.js";
import { preprocessForNlu } from "../../automation/voice/nlu/preprocess.js";
import { speechForGptPlanner } from "../../automation/voice/nlu/aiFirstRouting.js";
import { getLlmSessionContext } from "../../storage/conversationContext.js";
import { worldModelForLlm } from "../worldModel.js";
import { recordPlannerSource } from "../../telemetry/commandTelemetry.js";
import type { PlannerPipelineResult } from "./planTypes.js";
import {
  buildPlannerPromptContext,
  categoriesForDeferReason,
  intentHintForDeferReason,
} from "./plannerPrompt.js";
import { shouldTryGptFallback } from "./gptFallbackPolicy.js";
import { executionPlanFromLlmPlan } from "./gptPlanMapper.js";
import { passesConfidenceGate, validatePlan } from "./planValidator.js";
import { shadowFromPipelineResult } from "./planLogger.js";
import { storeCachedPlan } from "./planCache.js";
import { confidenceDecisionLabel, evaluatePlanConfidence } from "./confidenceEngine.js";

export type GptPlannerFallbackInput = {
  command: string;
  normalized: string;
  world: WorldModel;
  deferReason: string;
  getAccessToken: () => Promise<string | null>;
};

/**
 * P8.5d/e — GPT path when L0 defers. Uses existing backend desktop-intent API.
 */
export async function tryGptPlannerFallback(
  input: GptPlannerFallbackInput,
): Promise<PlannerPipelineResult> {
  const started = Date.now();
  const raw = input.command.trim();

  if (!shouldTryGptFallback(input.deferReason, raw)) {
    return {
      kind: "defer",
      reason: input.deferReason,
      normalizedUtterance: input.normalized,
    };
  }

  const accessToken = await input.getAccessToken();
  if (!accessToken) {
    const result: PlannerPipelineResult = {
      kind: "defer",
      reason: `${input.deferReason}:no_auth`,
      normalizedUtterance: input.normalized,
    };
    shadowFromPipelineResult(raw, input.normalized, result, Date.now() - started);
    return result;
  }

  const intentHint = intentHintForDeferReason(input.deferReason);
  const promptCtx = buildPlannerPromptContext(input.world, {
    categories: categoriesForDeferReason(input.deferReason),
    intentHint,
  });

  const { nlu } = preprocessForNlu(raw);
  const gptSpeech = speechForGptPlanner(raw, nlu);

  console.info(
    `[ripple-p85] GPT fallback defer=${input.deferReason} manifest=${promptCtx.manifestVersion}` +
      (intentHint ? ` hint=${intentHint}` : ""),
  );

  const llmPlan = await fetchDesktopIntentFromLlm(
    accessToken,
    raw,
    gptSpeech ?? nlu,
    { ...getLlmSessionContext() },
    await worldModelForLlm(input.world),
    intentHint,
  );

  if (!llmPlan) {
    const result: PlannerPipelineResult = {
      kind: "defer",
      reason: `${input.deferReason}:gpt_miss`,
      normalizedUtterance: input.normalized,
    };
    shadowFromPipelineResult(raw, input.normalized, result, Date.now() - started);
    return result;
  }

  if (policyFor(llmPlan.confidence, 1) === "rephrase") {
    const result: PlannerPipelineResult = {
      kind: "clarify",
      question: "I'm not confident I understood that. Can you rephrase?",
      confidence: llmPlan.confidence,
      reason: "gpt_low_confidence",
    };
    shadowFromPipelineResult(raw, input.normalized, result, Date.now() - started);
    return result;
  }

  const executionPlan = executionPlanFromLlmPlan(llmPlan, raw, input.normalized);
  if (!executionPlan) {
    const result: PlannerPipelineResult = {
      kind: "defer",
      reason: `${input.deferReason}:gpt_map_miss`,
      normalizedUtterance: input.normalized,
    };
    shadowFromPipelineResult(raw, input.normalized, result, Date.now() - started);
    return result;
  }

  const validation = validatePlan(executionPlan, input.world, raw);
  if (!validation.valid) {
    const result: PlannerPipelineResult = {
      kind: "defer",
      reason: `gpt_validation_failed:${validation.errors.join(",")}`,
      normalizedUtterance: input.normalized,
    };
    shadowFromPipelineResult(raw, input.normalized, result, Date.now() - started);
    return result;
  }

  const sanitized = validation.sanitizedPlan ?? executionPlan;
  const confidence = evaluatePlanConfidence(sanitized);
  console.info(`[ripple-p85] confidence ${confidenceDecisionLabel(confidence)}`);

  if (!passesConfidenceGate(sanitized)) {
    const result: PlannerPipelineResult = {
      kind: "clarify",
      question:
        sanitized.clarificationQuestion ??
        "I'm not sure what you meant. Can you say that again more specifically?",
      confidence: sanitized.confidence,
      reason: "gpt_low_confidence",
      plan: sanitized,
    };
    shadowFromPipelineResult(raw, input.normalized, result, Date.now() - started);
    return result;
  }

  recordPlannerSource("gpt", raw);
  storeCachedPlan(input.normalized, input.world, sanitized);
  const result: PlannerPipelineResult = {
    kind: "execute",
    plan: sanitized,
    validation,
  };
  shadowFromPipelineResult(raw, input.normalized, result, Date.now() - started);
  return result;
}
