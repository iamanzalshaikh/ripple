import { parseSimpleCompoundPartForGate } from "./compoundClauseResolve.js";
import { nativeIntentToPlanStep } from "./nativeIntentToPlanStep.js";
import type { ExecutionPlan, PlanStep } from "./planTypes.js";
import { plannerV2CompoundEnabled } from "./v2/plannerV2Config.js";
import { classifyClause } from "./v2/clauseClassifier.js";
import { planTailFromUnresolved } from "./v2/completionPolicy.js";
import { tryPlanCodeRepairTail } from "./developerWorkflowPlanner.js";
import { getPendingCodeRepair } from "./codeRepairSession.js";

const DRAW_CIRCLE =
  /^draw\s+(?:a\s+)?(?:circle|oval)\b/i;
const DRAW_RECT =
  /^draw\s+(?:a\s+)?(?:square|rectangle|rect)\b/i;
const DRAW_LINE = /^draw\s+(?:a\s+)?line\b/i;

const CODE_REPAIR_CLAUSE =
  /fix (?:the )?affected files|apply (?:the )?(?:safe )?fix(?:es)?|code[_\s-]?repair|run the project tests after the fix/i;

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
  const codeRepairTail = tryPlanCodeRepairTail(clauses, ctx);
  if (codeRepairTail) return codeRepairTail;

  // Never fall through to planner v2 for CODE_REPAIR tails — it invents
  // typecheck/run_tests with projectRoot "." (ripple-desktop, not the target).
  if (clauses.some((c) => CODE_REPAIR_CLAUSE.test(c))) {
    console.info(
      "[ripple-p85] code_repair: refusing planner-v2 fallback tail (would use wrong cwd)",
    );
    return null;
  }

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
  if (unresolved.some((c) => CODE_REPAIR_CLAUSE.test(c))) {
    const pending = getPendingCodeRepair();
    const diagCount = pending?.diagnostics?.length ?? 0;
    if (diagCount === 0) {
      return (
        "Audit finished. TypeScript found 0 errors, so there is nothing for auto-fix to patch. " +
        "Heuristic findings (console.error, auth races, missing test script) are warnings only — " +
        "Ripple only auto-patches safe TypeScript syntax/type errors. " +
        "Introduce a real tsc error (or open a project that fails typecheck), then say the same command again."
      );
    }
    return (
      `Audit finished with ${diagCount} TypeScript error(s), but none have a safe automatic patch yet. ` +
      'Review the typecheck report, or tell me the exact file + find/replace.'
    );
  }
  const clause = unresolved[0]?.trim() ?? "the next part";
  return `I completed the first part, but I can't automate "${clause}" yet. Can you say it differently or do that step manually?`;
}
