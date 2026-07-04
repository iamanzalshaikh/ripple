export type ConfidenceAction = "execute" | "clarify" | "rephrase";

/**
 * Single source of truth for planner confidence → action (§3.5).
 * Voice-first: execute when plausible; clarify only when very uncertain.
 */
export function policyFor(
  confidence: number,
  candidateCount: number,
): ConfidenceAction {
  if (confidence >= 0.9 && candidateCount <= 1) return "execute";
  if (confidence >= 0.4) return "execute";
  if (confidence >= 0.2) return "rephrase";
  return "clarify";
}

import { guidedNotFound } from "../../planner/guidedResponses.js";

export function rephraseHint(command: string): string {
  return guidedNotFound(command);
}
