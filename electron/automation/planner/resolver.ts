import type { Candidate } from "./types.js";
import { policyFor, rephraseHint } from "../voice/nlu/confidencePolicy.js";
import { shouldAutoExecute } from "../../storage/actionTrust.js";

export type ResolveResult =
  | { kind: "execute"; candidate: Candidate }
  | { kind: "clarify"; candidates: Candidate[]; question: string }
  | { kind: "rephrase"; hint: string }
  | { kind: "blocked"; reason: string };

function clarifyQuestion(spoken: string, count: number): string {
  return `Which one did you mean for "${spoken}"? (${count} matches)`;
}

/**
 * 0 / 1 / many candidate resolution — separate paths per count (§3.6).
 */
export function resolveCandidates(
  spoken: string,
  candidates: Candidate[],
  confidence: number,
): ResolveResult {
  const policy = policyFor(confidence, candidates.length);

  if (policy === "rephrase") {
    return { kind: "rephrase", hint: rephraseHint(spoken) };
  }

  if (candidates.length === 0) {
    if (confidence >= 0.9) {
      return {
        kind: "clarify",
        candidates: [],
        question: `I couldn't find "${spoken}". Try a different name or say which folder it's in.`,
      };
    }
    return { kind: "rephrase", hint: rephraseHint(spoken) };
  }

  if (candidates.length === 1) {
    if (policy === "execute") {
      return { kind: "execute", candidate: candidates[0]! };
    }
    return {
      kind: "clarify",
      candidates,
      question: `Open ${candidates[0]!.label}?`,
    };
  }

  const top = candidates[0]!;
  if (shouldAutoExecute(spoken, confidence) && top.score >= 0.85) {
    return { kind: "execute", candidate: top };
  }

  return {
    kind: "clarify",
    candidates: candidates.slice(0, 5),
    question: clarifyQuestion(spoken, candidates.length),
  };
}
