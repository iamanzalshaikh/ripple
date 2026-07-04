import { parseSimpleCompoundPartForGate } from "./compoundClauseResolve.js";
import { nativeIntentToPlanStep } from "./nativeIntentToPlanStep.js";
import type { ExecutionPlan, PlanStep } from "./planTypes.js";
import { plannerV2CompoundEnabled } from "./v2/plannerV2Config.js";
import { classifyClause } from "./v2/clauseClassifier.js";
import { planTailFromUnresolved } from "./v2/completionPolicy.js";

const DRAW_CIRCLE =
  /^draw\s+(?:a\s+)?(?:circle|oval)\b/i;
const DRAW_RECT =
  /^draw\s+(?:a\s+)?(?:square|rectangle|rect)\b/i;
const DRAW_LINE = /^draw\s+(?:a\s+)?line\b/i;

function drawEllipseSteps(radius = 72): PlanStep[] {
  return [
    {
      tool: "desktop.mouse_move",
      args: { moveToCenter: true },
      reason: "canvas_center",
    },
    {
      tool: "desktop.mouse_drag",
      args: { shape: "ellipse", radius, moveToCenter: true },
      reason: "draw_circle",
    },
  ];
}

function drawRectSteps(radius = 72): PlanStep[] {
  return [
    {
      tool: "desktop.mouse_move",
      args: { moveToCenter: true },
      reason: "canvas_center",
    },
    {
      tool: "desktop.mouse_drag",
      args: { shape: "rect", radius, moveToCenter: true },
      reason: "draw_rectangle",
    },
  ];
}

function drawLineSteps(length = 140): PlanStep[] {
  return [
    {
      tool: "desktop.mouse_move",
      args: { moveToCenter: true },
      reason: "canvas_center",
    },
    {
      tool: "desktop.mouse_drag",
      args: { shape: "line", length, moveToCenter: true },
      reason: "draw_line",
    },
  ];
}

/** Map an unresolved compound clause to executable tail steps (Phase B Stage 2). */
export function tryPlanUnresolvedClause(clause: string): PlanStep[] | null {
  const trimmed = clause.trim();
  if (DRAW_CIRCLE.test(trimmed)) return drawEllipseSteps();
  if (DRAW_RECT.test(trimmed)) return drawRectSteps();
  if (DRAW_LINE.test(trimmed)) return drawLineSteps();

  const intent = parseSimpleCompoundPartForGate(trimmed);
  const step = intent ? nativeIntentToPlanStep(intent) : null;
  if (step) return [step];

  return null;
}

export function tryPlanUnresolvedClauses(
  clauses: string[],
  ctx: { rawCommand: string; normalized: string },
): ExecutionPlan | null {
  if (plannerV2CompoundEnabled()) {
    const records = clauses.map((clause, index) =>
      classifyClause(clause.trim(), index, { priorRecords: [] }),
    );
    return planTailFromUnresolved(records, records, ctx);
  }

  const steps: PlanStep[] = [];
  for (const clause of clauses) {
    const part = tryPlanUnresolvedClause(clause);
    if (!part?.length) return null;
    steps.push(...part);
  }
  if (!steps.length) return null;
  return {
    goal: "Compound tail (Phase B)",
    confidence: 0.68,
    steps,
    rawUtterance: ctx.rawCommand,
    normalizedUtterance: ctx.normalized,
    source: "L0",
  };
}

export function compoundPartialTailQuestion(unresolved: string[]): string {
  const clause = unresolved[0]?.trim() ?? "the next part";
  return `I completed the first part, but I can't automate "${clause}" yet. Can you say it differently or do that step manually?`;
}
