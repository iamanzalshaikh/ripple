import { recordCommandEvent } from "../../telemetry/commandTelemetry.js";
import type { Candidate } from "../planner/types.js";

/** P5 — log retriever outcomes for observability dashboard. */
export function recordRetrieverOutcome(
  phrase: string,
  candidates: Candidate[],
  detail?: string,
): void {
  if (candidates.length === 0) {
    recordCommandEvent({
      command: phrase.slice(0, 200),
      outcome: "not_found",
      planner_source: "offline",
      detail: detail ?? "retriever_zero_hits",
    });
    return;
  }

  const top = candidates[0]!;
  recordCommandEvent({
    command: phrase.slice(0, 200),
    outcome: "success",
    planner_source: "offline",
    detail: `retriever:${top.source}:${candidates.length}`,
    confidence: top.score,
  });
}
