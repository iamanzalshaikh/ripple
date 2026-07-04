import { getCompoundParts } from "../utteranceClassifier.js";
import type { L0PlannerResult } from "../planTypes.js";
import { parseFileOperationCommand } from "../../../automation/desktop/parseFileOperationCommand.js";
import { parseAliasMetaCommand } from "../../../automation/desktop/parseAliasCommand.js";
import { parseSessionMemoryCommand } from "../../../automation/desktop/parseSessionMemoryCommand.js";
import { parseWorkflowMetaCommand } from "../../../automation/desktop/parseWorkflowCommand.js";
import { isRememberWorkflowPhrase } from "../../../automation/desktop/spokenName.js";
import { normalizeTranscript } from "../../../automation/voice/normalizeTranscript.js";
import { classifyClauses } from "./clauseClassifier.js";
import { applyCompletionPolicy, selectCompletionOutcome } from "./completionPolicy.js";
import { assembleCompoundPlan } from "./planAssembler.js";
import type { PlannerV2AtomicResult } from "./clauseTypes.js";
import { classifyClause } from "./clauseClassifier.js";
import { routeRecordToSteps } from "./toolRoutingMatrix.js";
import { hasRegisteredTool } from "../toolRegistry.js";

function isSemanticMemoryUtterance(rawCommand: string, normalized: string): boolean {
  const norm = normalizeTranscript(rawCommand) || normalized;
  return Boolean(
    parseSessionMemoryCommand(norm) ||
      parseWorkflowMetaCommand(norm) ||
      isRememberWorkflowPhrase(norm) ||
      parseAliasMetaCommand(norm),
  );
}

function logV2CompoundStart(clauseCount: number, normalized: string): void {
  if (process.env.RIPPLE_P85_PLANNER_V2_TRACE === "0") return;
  console.info(
    `[planner-v2] classify utterance=compound clauses=${clauseCount} norm="${normalized.slice(0, 60)}"`,
  );
}

/** Planner v2 — compound entry (L2–L5). */
export function planCompoundWithV2(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  if (parseFileOperationCommand(normalized)) {
    return null;
  }

  const parts = getCompoundParts(rawCommand, normalized);
  if (!parts || parts.length < 2) return null;

  logV2CompoundStart(parts.length, normalized);
  let records = classifyClauses(parts);

  const allUnknown = records.every(
    (r) =>
      r.clauseType === "UNKNOWN" ||
      r.status === "unsupported" ||
      !routeRecordToSteps(r)?.length,
  );
  if (allUnknown) {
    const mono = planAtomicWithV2(rawCommand, normalized);
    if (mono?.kind === "plan") {
      return { kind: "plan", plan: mono.plan };
    }
    return null;
  }

  for (const r of records) {
    const steps = routeRecordToSteps(r);
    const tool = steps?.map((s) => s.tool).join("+") ?? "-";
    if (process.env.RIPPLE_P85_PLANNER_V2_TRACE !== "0") {
      console.info(
        `[planner-v2] clause[${r.index}] type=${r.clauseType} tool=${tool} conf=${r.confidence.toFixed(2)}`,
      );
    }
  }

  const outcome = selectCompletionOutcome(
    records,
    records.some((r) => r.status !== "resolved" || !routeRecordToSteps(r)?.length),
  );

  let assembled = assembleCompoundPlan(records, rawCommand, normalized, outcome);
  if (!assembled) return null;

  assembled = applyCompletionPolicy(assembled, records, rawCommand, normalized);

  if (assembled.kind === "plan") {
    if (process.env.RIPPLE_P85_PLANNER_V2_TRACE !== "0") {
      console.info(
        `[planner-v2] outcome=${assembled.outcome} steps=${assembled.plan.steps.length}`,
      );
    }
    return { kind: "plan", plan: assembled.plan };
  }

  if (assembled.kind === "partial") {
    return {
      kind: "partial",
      plan: assembled.plan,
      unresolvedClauses: assembled.unresolvedClauses,
      splitPreview: assembled.splitPreview,
      question: assembled.question,
      confidence: assembled.confidence,
      reason: "compound_partial_v2",
    };
  }

  return {
    kind: "clarify",
    question: assembled.question,
    confidence: assembled.confidence,
    reason: assembled.reason,
  };
}

/** Planner v2 — single-clause atomic entry. */
export function planAtomicWithV2(
  rawCommand: string,
  normalized: string,
): PlannerV2AtomicResult | null {
  if (isSemanticMemoryUtterance(rawCommand, normalized)) {
    return null;
  }

  const record = classifyClause(rawCommand, 0, { priorRecords: [] });

  if (record.clauseType === "UNKNOWN" || record.status === "unsupported") {
    return null;
  }

  if (record.clauseType === "FILE_SEARCH" && !hasRegisteredTool("memory.search")) {
    return {
      kind: "clarify",
      question: `I can't search files for "${record.entities.searchQuery ?? rawCommand}" yet. Try opening a folder first.`,
      record,
    };
  }

  const steps = routeRecordToSteps(record);
  if (!steps?.length) {
    return null;
  }

  if (process.env.RIPPLE_P85_PLANNER_V2_TRACE !== "0") {
    console.info(
      `[planner-v2] atomic type=${record.clauseType} tools=${steps.map((s) => s.tool).join(",")}`,
    );
  }

  return {
    kind: "plan",
    record,
    step: steps[0]!,
    plan: {
      goal: `Desktop: ${record.clauseType} (Planner v2)`,
      confidence: record.confidence,
      steps,
      rawUtterance: rawCommand,
      normalizedUtterance: normalized,
      source: "L0",
    },
  };
}

export { planTailFromUnresolved } from "./completionPolicy.js";
