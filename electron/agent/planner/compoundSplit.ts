import type { NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import type {
  CompoundStepPreview,
  ExecutionPlan,
  PlannerPartialResult,
  PlanStep,
} from "./planTypes.js";
import { nativeIntentToPlanStep } from "./nativeIntentToPlanStep.js";
import { nativeIntentsToPlanSteps } from "./nativeIntentToPlanStep.js";
import { parseSimpleCompoundPartForGate } from "./compoundClauseResolve.js";
import { getCompoundParts } from "./utteranceClassifier.js";
import { compoundUnresolvedQuestion } from "./l0CompoundPlanner.js";

const UNRESOLVED_VERB =
  /^(draw|sketch|paint|erase|click|scroll|drag|select|move|fill|press)\b/i;

function summarizeResolvedStep(
  intent: NativeCommandIntent,
  step: PlanStep | null,
): string {
  switch (intent.kind) {
    case "launch_app":
    case "switch_app":
    case "close_app":
      return `open ${intent.rawName ?? intent.app.id}`;
    case "type_text":
      if (intent.text?.trim()) return `type ${intent.text.trim()}`;
      return "type text";
    case "folder":
      return `open ${intent.folder}`;
    case "file":
      return `open file ${intent.filename}`;
    case "item":
      return intent.parent
        ? `open ${intent.name} in ${intent.parent}`
        : `open ${intent.name}`;
    case "save_file":
      return `save as ${intent.filename}`;
    case "open_workspace":
      return `open ${intent.spokenName ?? intent.workspace.id}`;
    case "browser_search":
      return `search ${intent.query}`;
    default:
      return step?.tool ?? intent.kind;
  }
}

function summarizeUnresolvedClause(clause: string): string {
  const verb = clause.match(UNRESOLVED_VERB)?.[1]?.toLowerCase();
  if (verb === "draw" || verb === "sketch") {
    const shape = clause.match(/\b(circle|square|rectangle|line|oval)\b/i)?.[1];
    return shape ? `${verb} ${shape.toLowerCase()}` : verb;
  }
  return verb ?? clause.trim().slice(0, 40);
}

export function validatePartialPlan(
  plan: ExecutionPlan,
  unresolvedClauses: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (plan.steps.length === 0) errors.push("no_resolved_steps");
  if (unresolvedClauses.length === 0) errors.push("no_unresolved_clauses");
  return { valid: errors.length === 0, errors };
}

/**
 * Split compound utterance into resolved plan steps + unresolved clause tail.
 * Returns null when all clauses resolve or none resolve.
 */
export function tryL0PartialCompoundPlan(
  rawCommand: string,
  normalized: string,
): {
  plan: ExecutionPlan;
  unresolvedClauses: string[];
  splitPreview: CompoundStepPreview[];
} | null {
  const parts = getCompoundParts(rawCommand, normalized);
  if (!parts || parts.length < 2) return null;

  const resolvedIntents: NativeCommandIntent[] = [];
  const unresolvedClauses: string[] = [];
  const splitPreview: CompoundStepPreview[] = [];

  for (let index = 0; index < parts.length; index++) {
    const clause = parts[index]!.trim();
    const intent = parseSimpleCompoundPartForGate(clause);
    const step = intent ? nativeIntentToPlanStep(intent) : null;
    if (intent && step) {
      resolvedIntents.push(intent);
      splitPreview.push({
        index,
        clause,
        status: "resolved",
        tool: step.tool,
        action: step.reason ?? intent.kind,
        summary: summarizeResolvedStep(intent, step),
      });
    } else {
      unresolvedClauses.push(clause);
      const verb = clause.match(UNRESOLVED_VERB)?.[1]?.toLowerCase();
      splitPreview.push({
        index,
        clause,
        status: "unresolved",
        action: verb ?? "unknown",
        summary: summarizeUnresolvedClause(clause),
      });
    }
  }

  if (resolvedIntents.length === 0 || unresolvedClauses.length === 0) {
    return null;
  }

  const planSteps = nativeIntentsToPlanSteps(resolvedIntents);
  if (!planSteps?.length) return null;

  const plan: ExecutionPlan = {
    goal: "Compound partial (L0)",
    confidence: 0.72,
    steps: planSteps,
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };

  const validation = validatePartialPlan(plan, unresolvedClauses);
  if (!validation.valid) return null;

  return { plan, unresolvedClauses, splitPreview };
}

export function buildCompoundPartialResult(
  rawCommand: string,
  normalized: string,
  partial: NonNullable<ReturnType<typeof tryL0PartialCompoundPlan>>,
): PlannerPartialResult {
  return {
    kind: "partial",
    plan: partial.plan,
    unresolvedClauses: partial.unresolvedClauses,
    splitPreview: partial.splitPreview,
    question: compoundUnresolvedQuestion(partial.unresolvedClauses),
    confidence: partial.plan.confidence,
    reason: "compound_partial",
  };
}
