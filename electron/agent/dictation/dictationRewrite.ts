import { applyCorrectionsToUtterance } from "../../storage/voiceCorrections.js";
import {
  aiRewriteDictation,
  analyzeDictationCorrection,
  generateDictationCorrection,
} from "./aiRewriteDictation.js";
import { detectCorrectionSignal } from "./correctionSignalDetector.js";
import type {
  CorrectionDecision,
  DictationDecisionLog,
  ProductionDictationRewriteResult,
} from "./dictationCorrectionTypes.js";
import { applyCorrectionDecision } from "./safeRewriteEngine.js";

export type DictationRewriteInput = {
  bufferText: string;
  utterance?: string;
  committedBuffer?: string;
  /** Apply P6 spoken→canonical mappings (P7.4). */
  applyMemoryCorrections?: boolean;
};

export type DictationRewriteResult = ProductionDictationRewriteResult;

/** Directive signals whose "not applied" result must stay literal (never cleaned). */
const DIRECTIVE_SIGNALS = new Set([
  "tone_directive",
  "delete_directive",
  "scratch_that",
]);

/**
 * Conservative fail-open guard for the always-on cleanup pass.
 * Reject output that dropped most of the content or ballooned (invented text),
 * so the worst case is typing the raw transcript — never worse than today.
 */
function cleanupWithinBounds(before: string, after: string): boolean {
  const cleaned = after.trim();
  if (!cleaned) return false;
  const b = before.trim().split(/\s+/).filter(Boolean).length;
  const a = cleaned.split(/\s+/).filter(Boolean).length;
  if (b === 0) return false;
  if (a < Math.max(1, Math.floor(b * 0.4))) return false;
  if (a > b * 2 + 5) return false;
  return true;
}

/**
 * Production P7.2 orchestrator:
 * signal detection → structured classifier → optional generator → safe apply.
 * Never executes OS tools and always preserves literal speech on uncertainty.
 */
export async function rewriteDictationBuffer(
  input: DictationRewriteInput,
): Promise<DictationRewriteResult> {
  const started = Date.now();
  const committedBuffer = input.committedBuffer?.trim() ?? "";
  const currentUtterance = input.utterance?.trim()
    ? `${input.bufferText.trim()} ${input.utterance.trim()}`.trim()
    : input.bufferText.trim();
  const signal = detectCorrectionSignal({
    currentUtterance,
    committedBuffer,
  });

  let decision: CorrectionDecision | null = signal.candidate ?? null;
  let layer2aCalled = false;
  let layer2bCalled = false;
  let generation = null;
  let modelUsed = "local-signal-v1";

  if (signal.requiresLLM) {
    layer2aCalled = true;
    const analyzed = await analyzeDictationCorrection({
      committedBuffer,
      currentUtterance,
      signalHint: signal.signal,
    });
    decision = analyzed?.decision ?? null;
    modelUsed = analyzed?.model ?? "none_fallback";
  }

  if (
    decision &&
    (decision.type === "tone_change" || decision.type === "rewrite") &&
    decision.confidence >= 0.8 &&
    decision.rewriteInstruction
  ) {
    layer2bCalled = true;
    const generated = await generateDictationCorrection({
      originalText: committedBuffer || currentUtterance,
      instruction: decision.rewriteInstruction,
    });
    generation = generated?.generation ?? null;
    modelUsed = generated?.model ?? modelUsed;
  }

  const applied = decision
    ? applyCorrectionDecision({
        committedBuffer,
        currentUtterance,
        signal,
        decision,
        generation,
      })
    : {
        applied: false,
        text: currentUtterance,
        dropped: [] as string[],
        reason: signal.requiresLLM ? "llm_unavailable" : "no_signal",
      };

  let finalText = applied.text;
  let cleanupApplied = false;
  let cleanupReason = applied.reason;

  // Always-on Wispr-style cleanup: whenever the structured pipeline left the
  // text unchanged (no signal, ambiguous "no", classifier said not-correction,
  // or LLM unavailable), run one conservative cleanup pass over the utterance.
  // Directive signals (tone/delete/scratch) are excluded — they either applied
  // structurally or must stay literal. Fully fail-open via cleanupWithinBounds.
  if (!applied.applied && !DIRECTIVE_SIGNALS.has(signal.signal)) {
    const cleaned = await aiRewriteDictation(currentUtterance, {
      surface: "dictation",
      previousText: committedBuffer || undefined,
    });
    if (
      cleaned &&
      cleaned.trim() !== currentUtterance.trim() &&
      cleanupWithinBounds(currentUtterance, cleaned)
    ) {
      finalText = cleaned.trim();
      cleanupApplied = true;
      cleanupReason = "ai_cleanup";
      modelUsed = "dictation_clean";
    }
  }

  const beforeMemory = finalText;

  if (input.applyMemoryCorrections !== false) {
    try {
      finalText = applyCorrectionsToUtterance(finalText);
    } catch {
      /* memory optional */
    }
  }

  const log: DictationDecisionLog = {
    input: currentUtterance,
    layer1Signal: signal.signal,
    layer1AutoApplied: Boolean(signal.candidate && applied.applied),
    layer2aCalled,
    layer2aDecision: layer2aCalled ? decision : null,
    layer2bCalled,
    layer2bDecision: generation,
    applied: applied.applied || cleanupApplied,
    dropped: applied.dropped,
    finalText: finalText.trim(),
    latencyMs: Date.now() - started,
    modelUsed,
    reason: cleanupReason,
  };
  console.info(`[ripple-dictation-decision] ${JSON.stringify(log)}`);

  return {
    finalText: finalText.trim(),
    kind: decision?.type ?? signal.signal,
    beforeMemory,
    decisionLog: log,
  };
}
