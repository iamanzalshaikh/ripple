import type { ExecutionPlan, PlanStep } from "../planTypes.js";
import { classifyClause } from "./clauseClassifier.js";
import type {
  ClauseRecord,
  CompletionOutcome,
  PlannerV2CompoundResult,
} from "./clauseTypes.js";
import { assembleCompoundPlan } from "./planAssembler.js";
import { routeRecordToSteps } from "./toolRoutingMatrix.js";

const DRAW_CIRCLE =
  /^draw\s+(?:a\s+)?(?:circle|oval)\b/i;

function logPlannerV2(
  message: string,
  records?: ClauseRecord[],
  outcome?: CompletionOutcome,
): void {
  if (process.env.RIPPLE_P85_PLANNER_V2_TRACE === "0") return;
  if (records?.length) {
    for (const r of records) {
      console.info(
        `[planner-v2] clause[${r.index}] type=${r.clauseType} conf=${r.confidence.toFixed(2)} source=${r.parseSource} status=${r.status}`,
      );
    }
  }
  if (outcome) {
    console.info(`[planner-v2] outcome=${outcome}${message ? ` ${message}` : ""}`);
  }
}

/** L5 — plan tail steps for unresolved clauses (matrix retry with full context). */
export function planTailFromUnresolved(
  unresolvedRecords: ClauseRecord[],
  allRecords: ClauseRecord[],
  ctx: { rawCommand: string; normalized: string },
): ExecutionPlan | null {
  const steps: PlanStep[] = [];

  for (const unresolved of unresolvedRecords) {
    const index = allRecords.findIndex((r) => r.index === unresolved.index);
    const prior = index > 0 ? allRecords.slice(0, index) : [];
    const reclassified = classifyClause(unresolved.raw, unresolved.index, {
      priorRecords: prior,
    });
    const tailSteps = routeRecordToSteps(reclassified);
    if (!tailSteps?.length) {
      if (DRAW_CIRCLE.test(unresolved.normalized)) {
        steps.push(
          { tool: "desktop.mouse_move", args: { moveToCenter: true }, reason: "canvas_center" },
          {
            tool: "desktop.mouse_drag",
            args: { shape: "ellipse", radius: 72, moveToCenter: true },
            reason: "draw_circle",
          },
        );
        continue;
      }
      return null;
    }
    steps.push(...tailSteps);
  }

  if (!steps.length) return null;

  return {
    goal: "Compound tail (Planner v2)",
    confidence: 0.7,
    steps,
    rawUtterance: ctx.rawCommand,
    normalizedUtterance: ctx.normalized,
    source: "L0",
  };
}

export function selectCompletionOutcome(
  records: ClauseRecord[],
  hasPartial: boolean,
): CompletionOutcome {
  if (!hasPartial) return "EXECUTE_FULL";

  const tailTypes = records
    .filter((r) => r.status !== "resolved")
    .map((r) => r.clauseType);

  if (tailTypes.some((t) => t === "MEDIA_SEARCH" || t === "WEB_SEARCH")) {
    const priorYoutube = records.some(
      (r) => r.clauseType === "WORKSPACE_OPEN" && r.entities.workspaceId === "youtube",
    );
    if (priorYoutube || tailTypes.includes("MEDIA_SEARCH")) {
      return "EXECUTE_PARTIAL_THEN_MEDIA";
    }
  }

  if (tailTypes.some((t) => t === "DRAW_SHAPE")) {
    return "EXECUTE_PARTIAL_THEN_TAIL";
  }

  if (tailTypes.length > 0) return "EXECUTE_PARTIAL_THEN_TAIL";
  return "CLARIFY_TAIL";
}

export function applyCompletionPolicy(
  assembled: PlannerV2CompoundResult,
  records: ClauseRecord[],
  rawCommand: string,
  normalized: string,
): PlannerV2CompoundResult {
  if (assembled.kind !== "partial") return assembled;

  const outcome = selectCompletionOutcome(records, true);
  logPlannerV2("", records, outcome);

  const tailPlan = planTailFromUnresolved(
    assembled.unresolvedRecords,
    records,
    { rawCommand, normalized },
  );

  if (tailPlan && outcome !== "CLARIFY_TAIL") {
    return {
      kind: "plan",
      outcome,
      plan: {
        goal: "Compound desktop (Planner v2 + tail)",
        confidence: 0.9,
        steps: [...assembled.plan.steps, ...tailPlan.steps],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  return { ...assembled, outcome };
}
