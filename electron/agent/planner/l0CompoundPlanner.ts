import type { NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import { normalizeTranscript } from "../../automation/voice/normalizeTranscript.js";
import { splitCompoundParts } from "../../automation/voice/nlu/compoundParse.js";
import type { L0PlannerResult } from "./planTypes.js";
import type { ExecutionPlan } from "./planTypes.js";
import { nativeIntentsToPlanSteps } from "./nativeIntentToPlanStep.js";
import { tracePlannerBranch } from "./plannerTrace.js";
import { parseSimpleCompoundPartForGate } from "./compoundClauseResolve.js";
import {
  compoundStickyEnabled,
  getCompoundParts,
} from "./utteranceClassifier.js";
import { extractDirectTypingText } from "../parseDesktopInput.js";
import { phaseBStage1Enabled } from "./phaseBConfig.js";
import {
  buildCompoundPartialResult,
  tryL0PartialCompoundPlan,
} from "./compoundSplit.js";
import { plannerV2CompoundEnabled } from "./v2/plannerV2Config.js";
import { planCompoundWithV2 } from "./v2/plannerV2.js";

const COMPOUND_STEP_KINDS = new Set<NativeCommandIntent["kind"]>([
  "launch_app",
  "switch_app",
  "close_app",
  "minimize_all",
  "folder",
  "file",
  "item",
  "open_alias",
  "open_workspace",
  "browser_search",
  "type_text",
  "open_resolved",
  "save_file",
]);

function isWave1Compound(steps: NativeCommandIntent[]): boolean {
  if (steps.length < 2 || steps.length > 6) return false;
  if (!steps.every((s) => COMPOUND_STEP_KINDS.has(s.kind))) return false;
  if (steps.filter((s) => s.kind === "type_text").length > 1) return false;
  if (steps.filter((s) => s.kind === "save_file").length > 1) return false;
  return true;
}

/**
 * P8.5 L0 — multi-step compounds through Tool Executor:
 * "Open Notepad and type hello", "Open notepad, write notes and save as notes.txt in downloads"
 */
export function tryL0CompoundPlan(
  rawCommand: string,
  normalized: string,
): ExecutionPlan | null {
  if (plannerV2CompoundEnabled()) {
    const v2 = planCompoundWithV2(rawCommand, normalized);
    if (v2?.kind === "plan") return v2.plan;
    return null;
  }

  const transcript = normalizeTranscript(rawCommand) || normalized;
  const parts = splitCompoundParts(transcript);
  if (!parts || parts.length < 2) return null;

  const intents: NativeCommandIntent[] = [];
  for (const part of parts) {
    const intent = parseSimpleCompoundPartForGate(part);
    if (!intent) return null;
    intents.push(intent);
  }

  if (!isWave1Compound(intents)) return null;

  const planSteps = nativeIntentsToPlanSteps(intents);
  if (!planSteps?.length) return null;

  return {
    goal: "Compound desktop (L0)",
    confidence: 0.91,
    steps: planSteps,
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function unresolvedCompoundClauses(
  rawCommand: string,
  normalized: string,
): string[] {
  const parts = getCompoundParts(rawCommand, normalized);
  if (!parts) return [];
  const unresolved: string[] = [];
  for (const part of parts) {
    if (!parseSimpleCompoundPartForGate(part)) unresolved.push(part.trim());
  }
  return unresolved;
}

export function compoundUnresolvedQuestion(unresolved: string[]): string {
  const clause = unresolved[0]?.trim() ?? "the next part";
  return `I understood part of that, but I'm not sure how to "${clause}". Can you say it differently or split into separate commands?`;
}

/**
 * Compound-only planner — never falls through to full-string atomic parsers when sticky gate is on.
 */
export function runCompoundPlanner(
  rawCommand: string,
  normalized: string,
): L0PlannerResult {
  tracePlannerBranch("compound", "runCompoundPlanner", "clause");

  if (plannerV2CompoundEnabled()) {
    const v2 = planCompoundWithV2(rawCommand, normalized);
    if (v2) {
      tracePlannerBranch(
        "compound",
        v2.kind === "plan" ? "plan" : v2.kind,
        "planner_v2",
      );
      return v2;
    }
  }

  const plan = tryL0CompoundPlan(rawCommand, normalized);
  if (plan) {
    tracePlannerBranch("compound", "plan", "plan", plan.steps.map((s) => s.tool).join(","));
    return { kind: "plan", plan };
  }

  if (!compoundStickyEnabled()) {
    return { kind: "defer", reason: "compound_legacy_fallthrough" };
  }

  if (phaseBStage1Enabled()) {
    const partial = tryL0PartialCompoundPlan(rawCommand, normalized);
    if (partial) {
      tracePlannerBranch(
        "compound",
        "partial",
        "clause",
        partial.splitPreview.map((s) => s.summary ?? s.clause).join(" | "),
      );
      const built = buildCompoundPartialResult(rawCommand, normalized, partial);
      return {
        kind: "partial",
        plan: built.plan,
        unresolvedClauses: built.unresolvedClauses,
        splitPreview: built.splitPreview,
        question: built.question,
        confidence: built.confidence,
        reason: built.reason,
      };
    }
  }

  const unresolved = unresolvedCompoundClauses(rawCommand, normalized);
  tracePlannerBranch(
    "compound",
    "unresolved",
    "clause",
    unresolved.join(" | "),
  );

  return {
    kind: "clarify",
    question: compoundUnresolvedQuestion(unresolved),
    confidence: 0.55,
    reason: "compound_unresolved",
  };
}

/** Strip save clause from typing text when compound decomposition fails. */
export function typingTextWithoutSaveClause(command: string): string | null {
  const typed = extractDirectTypingText(command);
  if (!typed) return null;
  const stripped = typed
    .replace(
      /\s*,\s*save\s+(?:the\s+)?(?:file\s+)?as\s+.+$/i,
      "",
    )
    .replace(
      /\s+and\s+save\s+(?:the\s+)?(?:file\s+)?as\s+.+$/i,
      "",
    )
    .trim();
  return stripped || null;
}
