import type { CommandResultPayload } from "../types.js";
import {
  buildDesktopCommandResult,
  commandPayloadFromIntent,
  commandPayloadFromResolvedPath,
} from "../desktop/desktopCommand.js";
import {
  isLikelyDesktopCommand,
  isRegionalLanguageCommand,
} from "../voice/nlu/desktopIntentGuard.js";
import {
  nluForGptPlanner,
  shouldSkipFastPathForGpt,
  shouldUseGptRawOnly,
  speechForGptPlanner,
} from "../voice/nlu/aiFirstRouting.js";
import { preprocessForNlu } from "../voice/nlu/preprocess.js";
import { isGmailComposeFocused, isLinkedInTabActive, isYouTubeFocused } from "../../focus/focusContext.js";
import { isContextualLinkedInVoiceCommand } from "../adapters/linkedin/parseLinkedInCommand.js";
import { isContextualYouTubeVoiceCommand } from "../adapters/youtube/parseYouTubeCommand.js";
import { looksLikeBoxDrawingMojibake } from "../voice/i18n/repairEncoding.js";
import { policyFor } from "../voice/nlu/confidencePolicy.js";
import { fetchDesktopIntentFromLlm } from "../voice/nlu/llmIntent.js";
import { nativeIntentFromLlmPlan } from "../voice/nlu/intentFromLlm.js";
import { permissionForCommand } from "../safety/permissionEngine.js";
import {
  rateLimitForPayload,
  recordActionUse,
  primaryToolFromPayload,
} from "../safety/actionLimiter.js";
import { extractSearchToken } from "../retriever/extractSearchToken.js";
import {
  recordCommandEvent,
  recordPlannerSource,
  type PlannerSource,
} from "../../telemetry/commandTelemetry.js";
import { getCapabilityCacheHit } from "../../storage/capabilityCache.js";
import { graphLookup } from "../retriever/graphLookup.js";
import { retrieveFileCandidates } from "../retriever/retriever.js";
import { resolveCandidates } from "./resolver.js";
import {
  guidedApiUnavailable,
  guidedGptMapMiss,
  guidedNotFound,
} from "./guidedResponses.js";
import { getLlmSessionContext } from "../../storage/conversationContext.js";
import type { PlanExecuteResult } from "./types.js";

function payloadConfidence(source: PlannerSource, llmConfidence?: number): number {
  if (source === "fast" || source === "offline" || source === "graph") return 0.95;
  return llmConfidence ?? 0.7;
}

function checkRateLimit(
  command: string,
  payload: CommandResultPayload,
): PlanExecuteResult | null {
  const blocked = rateLimitForPayload(payload);
  if (!blocked) return null;
  recordCommandEvent({
    command,
    outcome: "blocked",
    detail: "rate_limit",
  });
  return { kind: "blocked", message: blocked, reason: "rate_limit" };
}

function checkPermission(
  command: string,
  payload: CommandResultPayload,
): PlanExecuteResult | null {
  const perm = permissionForCommand(command, payload);
  if (perm.level === "blocked") {
    recordCommandEvent({
      command,
      outcome: "blocked",
      permission: "blocked",
      detail: perm.reason,
    });
    return {
      kind: "blocked",
      message: perm.reason ?? "Command blocked by policy.",
      reason: perm.reason ?? "blocked",
    };
  }
  if (perm.level === "confirm") {
    recordCommandEvent({
      command,
      outcome: "success",
      permission: "confirm",
      detail: perm.reason ?? "destructive_op",
    });
  }
  return null;
}

function payloadFromPath(
  command: string,
  path: string,
  source: PlannerSource,
  confidence: number,
  tag: string,
): PlanExecuteResult {
  const payload = commandPayloadFromResolvedPath(command, path, tag);
  const limited = checkRateLimit(command, payload);
  if (limited) return limited;
  const blocked = checkPermission(command, payload);
  if (blocked) return blocked;
  return { kind: "payload", payload, source, confidence };
}

function notFoundResult(command: string, detail: string): PlanExecuteResult {
  recordCommandEvent({
    command,
    outcome: "not_found",
    planner_source: "gpt",
    detail,
  });
  return { kind: "not_found", hint: guidedNotFound(command) };
}

async function tryGroundedLookup(
  command: string,
  nlu: string,
): Promise<PlanExecuteResult | null> {
  const cacheHit =
    getCapabilityCacheHit(nlu) ?? getCapabilityCacheHit(command.trim());
  if (cacheHit) {
    recordPlannerSource("graph", command);
    return payloadFromPath(
      command,
      cacheHit.entity,
      "graph",
      cacheHit.confidence,
      " (cache)",
    );
  }

  const graphHit = graphLookup(nlu) ?? graphLookup(command.trim());
  if (graphHit) {
    recordPlannerSource("graph", command);
    return payloadFromPath(
      command,
      graphHit.path,
      "graph",
      graphHit.score,
      " (graph)",
    );
  }

  const openMatch = extractSearchToken(nlu) ?? extractSearchToken(command.trim());
  if (!openMatch) return null;

  const token = openMatch.trim();
  const candidates = await retrieveFileCandidates({
    phrase: nlu,
    token,
  });

  const resolved = resolveCandidates(token, candidates, 0.92);
  if (resolved.kind === "execute") {
    recordPlannerSource("offline", command);
    return payloadFromPath(
      command,
      resolved.candidate.path,
      "offline",
      resolved.candidate.score,
      " (retriever)",
    );
  }

  if (resolved.kind === "clarify") {
    return {
      kind: "clarify",
      question: resolved.question,
      candidates: resolved.candidates,
      confidence: 0.85,
    };
  }

  if (resolved.kind === "rephrase") {
    return { kind: "not_found", hint: resolved.hint };
  }

  return null;
}

async function tryGptPlanner(
  command: string,
  nlu: string | undefined,
  getAccessToken: () => Promise<string | null>,
): Promise<PlanExecuteResult | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    recordCommandEvent({
      command,
      outcome: "not_found",
      planner_source: "unknown",
      detail: "no_auth_token",
    });
    return { kind: "not_found", hint: guidedApiUnavailable() };
  }

  const plan = await fetchDesktopIntentFromLlm(
    accessToken,
    command,
    nlu,
    {
    ...getLlmSessionContext(),
  });

  if (!plan) {
    return null;
  }

  const native = nativeIntentFromLlmPlan(plan);
  if (!native) {
    recordCommandEvent({
      command,
      outcome: "not_found",
      planner_source: "gpt",
      detail: `map_miss:${plan.action}`,
    });
    return { kind: "not_found", hint: guidedGptMapMiss(command) };
  }

  if (policyFor(plan.confidence, 1) === "rephrase") {
    recordCommandEvent({
      command,
      outcome: "not_found",
      planner_source: "gpt",
      detail: `low_confidence:${plan.confidence}`,
    });
    return { kind: "not_found", hint: guidedNotFound(command) };
  }

  const payload = commandPayloadFromIntent(native, command, " (GPT)");
  const limited = checkRateLimit(command, payload);
  if (limited) return limited;
  const blocked = checkPermission(command, payload);
  if (blocked) return blocked;

  recordPlannerSource("gpt", command);

  return {
    kind: "payload",
    payload,
    source: "gpt",
    confidence: payloadConfidence("gpt", plan.confidence),
  };
}

/**
 * Cost ladder (§3.14, online-first): fast path → graph/retriever → GPT planner → guided not_found.
 */
export async function planDesktopCommand(
  command: string,
  getAccessToken: () => Promise<string | null>,
): Promise<PlanExecuteResult | null> {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (isGmailComposeFocused()) return null;
  if (
    isLinkedInTabActive() &&
    (isRegionalLanguageCommand(trimmed) || isContextualLinkedInVoiceCommand(trimmed))
  ) {
    return null;
  }
  if (
    isYouTubeFocused() &&
    (isRegionalLanguageCommand(trimmed) ||
      isContextualYouTubeVoiceCommand(trimmed) ||
      looksLikeBoxDrawingMojibake(trimmed))
  ) {
    return null;
  }

  const { nlu } = preprocessForNlu(trimmed);
  const fastCandidates =
    nlu.toLowerCase() !== trimmed.toLowerCase() ? [trimmed, nlu] : [trimmed];

  for (const candidate of fastCandidates) {
    const local = buildDesktopCommandResult(candidate);
    if (local && !shouldSkipFastPathForGpt(candidate)) {
      recordPlannerSource("fast", candidate);
      const blocked = checkPermission(trimmed, local);
      if (blocked) return blocked;
      return {
        kind: "payload",
        payload: local,
        source: "fast",
        confidence: payloadConfidence("fast"),
      };
    }
  }

  const shouldPlan =
    isLikelyDesktopCommand(trimmed) ||
    isRegionalLanguageCommand(trimmed) ||
    (nlu !== trimmed && isLikelyDesktopCommand(nlu));
  if (!shouldPlan) return null;

  const gptRawOnly = shouldUseGptRawOnly(trimmed);
  const gptSpeech = speechForGptPlanner(trimmed, nlu);

  if (gptRawOnly) {
    if (!gptSpeech) {
      console.info(
        "[ripple-desktop] GPT planner: raw speech only (AI-first, no local NLU)",
      );
    } else {
      console.info(
        `[ripple-desktop] GPT planner: multilingual NLU slots → ${gptSpeech.slice(0, 80)}`,
      );
    }
    const gpt = await tryGptPlanner(trimmed, gptSpeech, getAccessToken);
    if (gpt) return gpt;
    return notFoundResult(trimmed, "gpt_miss");
  }

  const grounded = await tryGroundedLookup(trimmed, nlu);
  if (grounded) return grounded;

  const gpt = await tryGptPlanner(
    trimmed,
    gptSpeech ?? speechForGptPlanner(trimmed, nlu),
    getAccessToken,
  );
  if (gpt) return gpt;

  return notFoundResult(trimmed, "gpt_miss");
}
