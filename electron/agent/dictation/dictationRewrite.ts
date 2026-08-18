import { applyCorrectionsToUtterance } from "../../storage/voiceCorrections.js";
import { resolveSnippetTrigger } from "../../storage/snippets.js";
import { getStyleProfileForProcess } from "../../storage/styleProfiles.js";
import type { StyleTone } from "../../storage/styleTone.js";
import {
  aiRewriteDictation,
  analyzeDictationCorrection,
  generateDictationCorrection,
} from "./aiRewriteDictation.js";
import { applyStyleTone } from "./correctionEngine.js";
import { detectCorrectionSignal } from "./correctionSignalDetector.js";
import {
  altCollapseIsPlausible,
  detectIntentAlternatives,
} from "./intentAlternatives.js";
import { detectSoftSelfCorrection } from "./softSelfCorrection.js";
import {
  detectSpokenList,
  formatSpokenList,
  formatTranscript,
  localCleanup,
  stripFillersAndStutters,
} from "./localCleanup.js";
import type {
  CorrectionDecision,
  DictationDecisionLog,
  ProductionDictationRewriteResult,
} from "./dictationCorrectionTypes.js";
import { applyCorrectionDecision } from "./safeRewriteEngine.js";
import {
  PIPELINE_LAYERS_HIGH,
  cleanupLevelForLayers,
  type PipelineLayers,
} from "./pipelineLayers.js";

export type DictationRewriteInput = {
  bufferText: string;
  utterance?: string;
  committedBuffer?: string;
  /** Apply P6 spoken→canonical mappings (P7.4). */
  applyMemoryCorrections?: boolean;
  /** Foreground process name (P7.3 — per-app Styles tone). */
  processName?: string;
  /**
   * Override pipeline layers (tests). When omitted, user prefs apply
   * (default High = current always-on cleanup + format + context).
   */
  layers?: PipelineLayers;
};

export type DictationRewriteResult = ProductionDictationRewriteResult;

/** Directive signals whose "not applied" result must stay literal (never cleaned). */
const DIRECTIVE_SIGNALS = new Set([
  "tone_directive",
  "delete_directive",
  "scratch_that",
]);

/**
 * Spoken self-correction markers. When present, cleanup may legitimately
 * drop earlier clauses. When absent, cleanup must stay near-literal.
 */
const CORRECTION_MARKERS =
  /\b(?:no(?:\s+no)?|nah|wait|actually|i\s+mean|scratch\s+that|instead)\b/i;

const GREETING_LEAD =
  /^(?:hello|hi|hey|dear|good\s+(?:morning|afternoon|evening))\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Sentence / clause-ish units (greeting + question counts as two). */
function clauseCount(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((p) => p.trim())
    .filter((p) => wordCount(p) >= 2).length;
}

/**
 * Addressee after a greeting — must survive cleanup
 * ("Hello Tathir, …" must not become "Can we meet…?").
 */
function greetingAddressee(text: string): string | null {
  const m = text.match(
    /\b(?:hello|hi|hey|dear)\s+([A-Za-z][A-Za-z'’-]{1,40})\b/i,
  );
  return m?.[1] ?? null;
}

export type CleanupBoundsOptions = {
  /**
   * When true (competing alternatives detected — greetings/times/offers),
   * allow AI cleanup to collapse to final intent. Existing correction-marker
   * path is unchanged; name + greeting lead still protected.
   */
  allowAlternativeCollapse?: boolean;
  /**
   * When true (soft mid-utterance revision class — sorry / I mean / wait…),
   * allow AI cleanup to drop the superseded clause. Not Layer-1 auto-apply.
   */
  allowSoftRevision?: boolean;
};

/**
 * Conservative fail-open guard for the always-on cleanup pass.
 * Rejects aggressive rewrites that delete greetings, names, or whole clauses
 * when the user did not signal a self-correction.
 *
 * Optional flags relax ratio/clause guards only — Layer-1 / name / greeting
 * lead protections stay. Default behavior unchanged.
 */
export function cleanupWithinBounds(
  before: string,
  after: string,
  opts?: CleanupBoundsOptions,
): boolean {
  const cleaned = after.trim();
  if (!cleaned) return false;
  const src = before.trim();
  const b = wordCount(src);
  const a = wordCount(cleaned);
  if (b === 0) return false;

  const hasCorrectionMarker = CORRECTION_MARKERS.test(src);
  const allowAlt = opts?.allowAlternativeCollapse === true;
  const allowSoft = opts?.allowSoftRevision === true;
  const allowDrop = hasCorrectionMarker || allowAlt || allowSoft;
  // Without an explicit correction, keep ~75% of words (was 40% — too loose).
  // With a marker / soft revision, allow surgical drops down to ~40%.
  // With competing alternatives only, allow ~55%.
  const minRatio = hasCorrectionMarker || allowSoft ? 0.4 : allowAlt ? 0.55 : 0.75;
  if (a < Math.max(1, Math.floor(b * minRatio))) return false;
  if (a > b * 2 + 5) return false;

  const charRatio = cleaned.length / Math.max(1, src.length);
  const minChar =
    hasCorrectionMarker || allowSoft ? 0.35 : allowAlt ? 0.5 : 0.7;
  if (!hasCorrectionMarker && !allowSoft && charRatio < minChar) return false;

  const beforeClauses = clauseCount(src);
  const afterClauses = clauseCount(cleaned);
  if (
    !allowDrop &&
    beforeClauses >= 2 &&
    afterClauses < beforeClauses
  ) {
    return false;
  }

  if (
    !hasCorrectionMarker &&
    !allowSoft &&
    GREETING_LEAD.test(src) &&
    !GREETING_LEAD.test(cleaned)
  ) {
    return false;
  }

  const name = greetingAddressee(src);
  if (
    name &&
    !new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(cleaned)
  ) {
    return false;
  }

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
  const layers = input.layers ?? PIPELINE_LAYERS_HIGH;
  const level = cleanupLevelForLayers(layers);
  const committedBuffer = input.committedBuffer?.trim() ?? "";
  const rawUtterance = input.utterance?.trim()
    ? `${input.bufferText.trim()} ${input.utterance.trim()}`.trim()
    : input.bufferText.trim();

  // Snippets (P7.2) — an utterance that IS a learned trigger phrase expands
  // verbatim and skips everything else. A snippet is a precise, user-authored
  // expansion; running it through correction/cleanup/AI-rewrite would risk
  // the same over-aggressive rewriting found elsewhere in this pipeline.
  const snippetExpansion = resolveSnippetTrigger(rawUtterance);
  if (snippetExpansion) {
    const log: DictationDecisionLog = {
      input: rawUtterance,
      layer1Signal: "snippet",
      layer1AutoApplied: true,
      layer2aCalled: false,
      layer2aDecision: null,
      layer2bCalled: false,
      layer2bDecision: null,
      applied: true,
      dropped: [],
      finalText: snippetExpansion,
      latencyMs: Date.now() - started,
      modelUsed: "snippet",
      reason: "snippet_expansion",
    };
    console.info(`[ripple-dictation-decision] ${JSON.stringify(log)}`);
    return {
      finalText: snippetExpansion,
      kind: "snippet",
      beforeMemory: rawUtterance,
      decisionLog: log,
    };
  }

  // Personal dictionary (P7.4) must resolve BEFORE signal detection / the
  // AI cleanup pass below — reproduced live: "hi nor" with nor->Noor taught
  // came back as "Hi." because the always-on cleanup treated "nor" as noise
  // and dropped it. Resolving known personal terms first protects them from
  // ever being treated as filler/noise by anything downstream.
  // cleanupWithinBounds also rejects greeting/name/clause drops without a
  // spoken correction marker (e.g. "Hello Tathir…?" → "Can we meet…?").
  const currentUtterance =
    input.applyMemoryCorrections !== false
      ? applyCorrectionsToUtterance(rawUtterance)
      : rawUtterance;

  const signal = detectCorrectionSignal({
    currentUtterance,
    committedBuffer,
  });

  let decision: CorrectionDecision | null = signal.candidate ?? null;
  let layer2aCalled = false;
  let layer2bCalled = false;
  let generation = null;
  let modelUsed = "local-signal-v1";

  if (layers.cleanup && signal.requiresLLM) {
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
    layers.cleanup &&
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
        reason: signal.requiresLLM
          ? layers.cleanup
            ? "llm_unavailable"
            : "cleanup_layer_off"
          : "no_signal",
      };

  let finalText = applied.text;
  let cleanupApplied = false;
  let cleanupReason = applied.reason;

  // Layered Wispr cleanup: skip AI/local passes the user turned off.
  // High (cleanup+format+context) is the historical always-on path.
  if (!applied.applied && !DIRECTIVE_SIGNALS.has(signal.signal)) {
    const spokenList = layers.format ? detectSpokenList(currentUtterance) : null;
    if (spokenList) {
      finalText = formatSpokenList(spokenList);
      cleanupApplied = true;
      cleanupReason = "list_format";
      modelUsed = "local-list-format";
    } else if (layers.cleanup && layers.format && layers.context) {
      const cleaned = await aiRewriteDictation(currentUtterance, {
        surface: "dictation",
        previousText: committedBuffer || undefined,
      });
      const alt = detectIntentAlternatives(currentUtterance);
      const soft = detectSoftSelfCorrection(currentUtterance);
      const boundsOk =
        !!cleaned &&
        cleaned.trim() !== currentUtterance.trim() &&
        cleanupWithinBounds(currentUtterance, cleaned, {
          allowAlternativeCollapse: alt.detected,
          allowSoftRevision: soft.detected,
        });
      const altOk =
        !alt.detected ||
        altCollapseIsPlausible(currentUtterance, cleaned ?? "", alt.kind);
      if (boundsOk && altOk && cleaned) {
        finalText = cleaned.trim();
        cleanupApplied = true;
        cleanupReason = soft.detected
          ? `ai_cleanup+soft_revision`
          : alt.detected
            ? `ai_cleanup+alt_${alt.kind}`
            : "ai_cleanup";
        modelUsed = "dictation_clean";
        if (soft.detected) {
          console.info(
            `[ripple-dictation] soft-revision cue=${soft.cue} reason=${soft.reason}`,
          );
        } else if (alt.detected) {
          console.info(
            `[ripple-dictation] alt-collapse kind=${alt.kind} reason=${alt.reason}`,
          );
        }
      } else {
        const local = localCleanup(currentUtterance);
        if (local && local !== currentUtterance) {
          finalText = local;
          cleanupApplied = true;
          cleanupReason = "local_cleanup";
          modelUsed = "local-cleanup-v1";
        }
      }
    } else if (layers.cleanup && layers.format) {
      const local = localCleanup(currentUtterance);
      if (local && local !== currentUtterance) {
        finalText = local;
        cleanupApplied = true;
        cleanupReason = "local_cleanup";
        modelUsed = "local-cleanup-v1";
      }
    } else if (layers.cleanup) {
      const stripped = stripFillersAndStutters(currentUtterance);
      if (stripped && stripped !== currentUtterance) {
        finalText = stripped;
        cleanupApplied = true;
        cleanupReason = "filler_only";
        modelUsed = "local-cleanup-light";
      }
    } else if (layers.format) {
      const formatted = formatTranscript(currentUtterance);
      if (formatted && formatted !== currentUtterance) {
        finalText = formatted;
        cleanupApplied = true;
        cleanupReason = "format_only";
        modelUsed = "local-format-v1";
      }
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

  // Styles (P7.3) — ambient per-app tone default. Only when the user did NOT
  // already give an explicit spoken tone instruction this utterance (that
  // already ran via the directive signal above and must win) — this is the
  // passive "in Slack, always keep it casual" behavior, not a one-off request.
  let styleApplied: StyleTone | null = null;
  if (layers.context && signal.signal !== "tone_directive" && finalText.trim()) {
    const tone = getStyleProfileForProcess(input.processName);
    if (tone !== "neutral") {
      finalText = applyStyleTone(finalText, tone);
      styleApplied = tone;
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
    reason: styleApplied ? `${cleanupReason}+style_${styleApplied}` : cleanupReason,
  };
  console.info(
    `[ripple-pipeline] transcribe=on cleanup=${layers.cleanup ? "on" : "off"} format=${layers.format ? "on" : "off"} context=${layers.context ? "on" : "off"} level=${level}`,
  );
  console.info(`[ripple-dictation-decision] ${JSON.stringify(log)}`);

  return {
    finalText: finalText.trim(),
    kind: decision?.type ?? signal.signal,
    beforeMemory,
    decisionLog: log,
  };
}
