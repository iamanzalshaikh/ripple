export type ConfidenceAction = "execute" | "clarify" | "rephrase";

/**
 * Single source of truth for planner confidence → action (§3.5).
 */
export function policyFor(
  confidence: number,
  candidateCount: number,
): ConfidenceAction {
  if (confidence >= 0.9 && candidateCount <= 1) return "execute";
  if (confidence >= 0.6) return "clarify";
  return "rephrase";
}

import { guidedNotFound } from "../../planner/guidedResponses.js";

export function rephraseHint(command: string): string {
  return guidedNotFound(command);
}
