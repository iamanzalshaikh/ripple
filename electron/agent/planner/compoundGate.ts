import type { PlannerPipelineResult } from "./planTypes.js";
import {
  classifyUtterance,
  compoundStickyEnabled,
  getCompoundParts,
} from "./utteranceClassifier.js";
import {
  compoundUnresolvedQuestion,
  tryL0CompoundPlan,
} from "./l0CompoundPlanner.js";
import { tracePlannerBranch } from "./plannerTrace.js";
import { parseSimpleCompoundPartForGate } from "./compoundClauseResolve.js";
import { phaseBStage1Enabled } from "./phaseBConfig.js";
import {
  buildCompoundPartialResult,
  tryL0PartialCompoundPlan,
} from "./compoundSplit.js";
import { plannerV2CompoundEnabled } from "./v2/plannerV2Config.js";
import { planCompoundWithV2 } from "./v2/plannerV2.js";
import { shouldBypassP85Planner } from "./gptFallbackPolicy.js";
import { isWhatsAppPlannerUtterance } from "./l0WhatsAppPlanner.js";
import { isYouTubePlannerUtterance } from "./l0YouTubePlanner.js";
import { isGmailPlannerUtterance } from "./l0GmailPlanner.js";
import { isLinkedInPlannerUtterance } from "./l0LinkedInPlanner.js";
import { isInstagramPlannerUtterance } from "./l0InstagramPlanner.js";
import { isSendItemPlannerUtterance } from "./l0SendItemPlanner.js";
import { isNotionPlannerUtterance } from "./l0NotionPlanner.js";
import { isFilesystemPlannerUtterance } from "./l0FilesystemPlanner.js";
import { isCreateFileInAppCommand } from "./planCreateFileInApp.js";
import { isDeveloperWorkflowUtterance } from "./developerWorkflowPlanner.js";
import { isSemanticIntentUtterance } from "./semanticIntentRouter.js";

/** True when utterance has ≥2 compound clauses (and/_then/comma boundaries). */
export function isCompoundUtterance(
  rawCommand: string,
  normalized: string,
): boolean {
  return classifyUtterance(rawCommand, normalized) === "compound";
}

function unresolvedClauses(rawCommand: string, normalized: string): string[] {
  const parts = getCompoundParts(rawCommand, normalized);
  if (!parts) return [];
  const unresolved: string[] = [];
  for (const part of parts) {
    if (!parseSimpleCompoundPartForGate(part)) {
      unresolved.push(part.trim());
    }
  }
  return unresolved;
}

/**
 * Defensive compound sticky gate — runs before any planner tier.
 * Full plan → proceed. Phase B Stage 1 → partial split+log. Else → clarify.
 */
export function tryCompoundGate(
  rawCommand: string,
  normalized: string,
): PlannerPipelineResult | null {
  if (shouldBypassP85Planner(rawCommand)) return null;
  if (isWhatsAppPlannerUtterance(rawCommand)) return null;
  if (isYouTubePlannerUtterance(rawCommand, normalized)) return null;
  if (isGmailPlannerUtterance(rawCommand, normalized)) return null;
  if (isLinkedInPlannerUtterance(rawCommand, normalized)) return null;
  if (isInstagramPlannerUtterance(rawCommand, normalized)) return null;
  if (isSendItemPlannerUtterance(rawCommand)) return null;
  if (isNotionPlannerUtterance(rawCommand, normalized)) return null;
  if (isFilesystemPlannerUtterance(rawCommand, normalized)) return null;
  if (isDeveloperWorkflowUtterance(rawCommand, normalized)) return null;
  if (isSemanticIntentUtterance(rawCommand, normalized)) return null;
  if (
    isCreateFileInAppCommand(rawCommand) ||
    isCreateFileInAppCommand(normalized)
  ) {
    return null;
  }
  if (!compoundStickyEnabled()) return null;
  if (!isCompoundUtterance(rawCommand, normalized)) return null;

  const plan = tryL0CompoundPlan(rawCommand, normalized);
  if (plan) return null;

  if (plannerV2CompoundEnabled()) {
    const v2 = planCompoundWithV2(rawCommand, normalized);
    if (v2?.kind === "plan") return null;
    if (v2?.kind === "partial") {
      tracePlannerBranch("compound_gate", "partial", "planner_v2");
      return {
        kind: "partial",
        plan: v2.plan,
        unresolvedClauses: v2.unresolvedClauses,
        splitPreview: v2.splitPreview,
        question: v2.question,
        confidence: v2.confidence,
        reason: v2.reason,
      };
    }
    if (v2?.kind === "clarify") {
      return {
        kind: "clarify",
        question: v2.question,
        confidence: v2.confidence,
        reason: v2.reason,
      };
    }
  }

  if (phaseBStage1Enabled()) {
    const partial = tryL0PartialCompoundPlan(rawCommand, normalized);
    if (partial) {
      tracePlannerBranch(
        "compound_gate",
        "partial",
        "clause",
        partial.splitPreview.map((s) => s.summary ?? s.clause).join(" | "),
      );
      return buildCompoundPartialResult(rawCommand, normalized, partial);
    }
  }

  const unresolved = unresolvedClauses(rawCommand, normalized);
  tracePlannerBranch("compound_gate", "clarify", "full", unresolved.join(" | "));

  return {
    kind: "clarify",
    question: compoundUnresolvedQuestion(unresolved),
    confidence: 0.55,
    reason: "compound_unresolved",
  };
}

/** @deprecated Use tryCompoundGate — kept for call-site clarity. */
export const tryCompoundGateClarify = tryCompoundGate;

/** Block legacy desktop-fast / payload paths when compound sticky is active. */
export function shouldBlockLegacyForCompound(
  rawCommand: string,
  normalized: string,
): boolean {
  if (shouldBypassP85Planner(rawCommand)) return false;
  if (!compoundStickyEnabled()) return false;
  return isCompoundUtterance(rawCommand, normalized);
}
