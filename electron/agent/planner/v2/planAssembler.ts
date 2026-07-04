import type { CompoundStepPreview, ExecutionPlan } from "../planTypes.js";
import type { PlanStep } from "../planTypes.js";
import { hasRegisteredTool } from "../toolRegistry.js";
import type {
  ClauseRecord,
  CompletionOutcome,
  PlannerV2CompoundResult,
} from "./clauseTypes.js";
import { routeRecordToSteps } from "./toolRoutingMatrix.js";

function summarizeRecord(record: ClauseRecord, tool?: string): string {
  switch (record.clauseType) {
    case "APP_LAUNCH":
    case "APP_FOCUS":
      return `${record.clauseType === "APP_FOCUS" ? "switch" : "open"} ${record.entities.spokenName ?? record.entities.appId ?? ""}`;
    case "WORKSPACE_OPEN":
      return `open ${record.entities.spokenName ?? record.entities.workspaceId ?? ""}`;
    case "WEB_SEARCH":
    case "MEDIA_SEARCH":
      return `search ${record.entities.searchQuery ?? ""}`;
    case "DRAW_SHAPE":
      return `draw ${record.entities.drawShape ?? "shape"}`;
    case "TYPE_TEXT":
      return `type ${record.entities.typeText ?? "text"}`;
    default:
      return tool ?? record.clauseType;
  }
}

function recordsToSteps(records: ClauseRecord[]): {
  steps: PlanStep[];
  resolved: ClauseRecord[];
  unresolved: ClauseRecord[];
} {
  const steps: PlanStep[] = [];
  const resolved: ClauseRecord[] = [];
  const unresolved: ClauseRecord[] = [];

  for (const record of records) {
    if (record.status !== "resolved") {
      unresolved.push(record);
      continue;
    }
    if (record.clauseType === "FILE_SEARCH" && !hasRegisteredTool("memory.search")) {
      unresolved.push({ ...record, status: "unsupported" });
      continue;
    }
    const part = routeRecordToSteps(record);
    if (!part?.length) {
      unresolved.push({ ...record, status: "unsupported" });
      continue;
    }
    resolved.push(record);
    steps.push(...part);
  }

  return { steps, resolved, unresolved };
}

function buildPreview(
  records: ClauseRecord[],
  resolved: ClauseRecord[],
  unresolved: ClauseRecord[],
): CompoundStepPreview[] {
  const resolvedSet = new Set(resolved);
  const unresolvedSet = new Set(unresolved);

  return records.map((record) => {
    const part = routeRecordToSteps(record);
    const tool = part?.[0]?.tool;
    if (resolvedSet.has(record)) {
      return {
        index: record.index,
        clause: record.raw,
        status: "resolved" as const,
        tool,
        action: record.clauseType,
        summary: summarizeRecord(record, tool),
      };
    }
    return {
      index: record.index,
      clause: record.raw,
      status: "unresolved" as const,
      action: record.clauseType,
      summary: summarizeRecord(record),
    };
  });
}

export function assembleCompoundPlan(
  records: ClauseRecord[],
  rawCommand: string,
  normalized: string,
  outcome: CompletionOutcome,
): PlannerV2CompoundResult | null {
  const { steps, resolved, unresolved } = recordsToSteps(records);

  if (resolved.length === records.length && steps.length > 0) {
    return {
      kind: "plan",
      outcome,
      plan: {
        goal: "Compound desktop (Planner v2)",
        confidence: 0.92,
        steps,
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (resolved.length === 0) {
    // Fall through to L0 / Phase B partial instead of blocking with clarify.
    return null;
  }

  if (unresolved.length > 0 && steps.length > 0) {
    const unresolvedRaw = unresolved.map((r) => r.raw.trim());
    return {
      kind: "partial",
      outcome,
      plan: {
        goal: "Compound partial (Planner v2)",
        confidence: 0.78,
        steps,
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
      unresolvedClauses: unresolvedRaw,
      unresolvedRecords: unresolved,
      splitPreview: buildPreview(records, resolved, unresolved),
      question: `I understood part of that, but I'm not sure how to "${unresolvedRaw[0]}". Can you say it differently?`,
      confidence: 0.72,
    };
  }

  return null;
}
