import { applyCorrectionsToUtterance } from "../../storage/voiceCorrections.js";
import { applyCorrectionHeuristics } from "./correctionEngine.js";

export type DictationRewriteInput = {
  bufferText: string;
  utterance?: string;
  /** Apply P6 spoken→canonical mappings (P7.4). */
  applyMemoryCorrections?: boolean;
};

export type DictationRewriteResult = {
  finalText: string;
  kind: string;
  beforeMemory: string;
};

/**
 * Heuristic rewrite (+ optional GPT later). Never executes OS tools.
 */
export function rewriteDictationBuffer(
  input: DictationRewriteInput,
): DictationRewriteResult {
  const corrected = applyCorrectionHeuristics(
    input.bufferText,
    input.utterance,
  );
  let finalText = corrected.text;
  const beforeMemory = finalText;

  if (input.applyMemoryCorrections !== false) {
    try {
      finalText = applyCorrectionsToUtterance(finalText);
    } catch {
      /* memory optional */
    }
  }

  return {
    finalText: finalText.trim(),
    kind: corrected.kind,
    beforeMemory,
  };
}
