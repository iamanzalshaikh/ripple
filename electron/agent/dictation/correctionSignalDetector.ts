import type {
  CorrectionDecision,
  SignalDetection,
} from "./dictationCorrectionTypes.js";

const IDIOMATIC_NO =
  /^(?:no problem|no worries|no chance|no idea|no thanks)\b/i;
const TONE_DIRECTIVE =
  /\b(?:make (?:it|this|that)?\s*(?:more\s+)?(?:professional|formal|casual|friendly|shorter|longer)|rewrite|rephrase)\b/i;
const DELETE_DIRECTIVE =
  /\b(?:delete|remove|erase)\s+(?:the\s+)?(?:last\s+(?:sentence|part|phrase)|that\s+(?:sentence|part|phrase)|(?:word|phrase)\s+.+)$/i;
const SCRATCH_THAT = /\bscratch\s+that\b/i;
const ACTUALLY_NO = /\b(?:actually\s*[,.]?\s*no|no\s*[,.]?\s*actually)\b/i;
const DOUBLE_NO = /\bno+\s*[,.]?\s*no+\b/i;
const SINGLE_NO = /\bno\b/i;
const BARE_ACTUALLY = /\bactually\b/i;
const REVISION_CUE = /\b(?:wait|sorry\s+make\s+that)\b/i;
const TEMPORAL =
  /\b(?:day after tomorrow|day before yesterday|tomorrow|today|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm|o'clock)?)\b/gi;

function decision(args: {
  type: CorrectionDecision["type"];
  scope?: CorrectionDecision["scope"];
  confidence: number;
  original: string | null;
  replacement: string | null;
  reason: string;
}): CorrectionDecision {
  return {
    isCorrection: args.type !== "none",
    type: args.type,
    scope: args.scope ?? "phrase",
    confidence: args.confidence,
    original: args.original,
    replacement: args.replacement,
    rewriteInstruction: null,
    correctionReason: "unknown",
    reason: args.reason,
  };
}

function lastTemporal(text: string): string | null {
  const matches = [...text.matchAll(TEMPORAL)];
  return matches.at(-1)?.[0] ?? null;
}

function safeMarkerCandidate(
  utterance: string,
  match: RegExpMatchArray,
): SignalDetection | null {
  const markerStart = match.index ?? -1;
  if (markerStart <= 0) return null;
  const markerEnd = markerStart + match[0].length;
  const head = utterance.slice(0, markerStart).replace(/[,\s]+$/, "").trim();
  const tail = utterance.slice(markerEnd).replace(/^[,\s]+/, "").trim();
  if (!head || !tail || tail.split(/\s+/).length > 8) return null;

  const original = lastTemporal(head);
  const replacementToken = lastTemporal(tail);
  if (!original || !replacementToken) return null;
  const replacement =
    /^day (?:after|before)\b/i.test(tail) && !/^the\s+/i.test(tail)
      ? `the ${tail}`
      : tail;

  return {
    detected: true,
    signal: ACTUALLY_NO.test(match[0]) ? "actually_no" : "double_no",
    confidence: 0.97,
    requiresLLM: false,
    marker: { start: markerStart, end: markerEnd },
    candidate: decision({
      type: "replace",
      confidence: 0.97,
      original,
      replacement,
      reason: "clear temporal replacement around strong correction marker",
    }),
  };
}

/**
 * Layer 1: detect signals only. It never mutates text.
 * Ambiguous signals are classified by Layer 2A.
 */
export function detectCorrectionSignal(args: {
  currentUtterance: string;
  committedBuffer?: string;
}): SignalDetection {
  const utterance = args.currentUtterance.trim();
  if (!utterance) {
    return {
      detected: false,
      signal: "none",
      confidence: 1,
      requiresLLM: false,
    };
  }

  if (IDIOMATIC_NO.test(utterance)) {
    return {
      detected: false,
      signal: "none",
      confidence: 0.99,
      requiresLLM: false,
      observation: "idiomatic_no_filtered",
    };
  }

  if (TONE_DIRECTIVE.test(utterance)) {
    return {
      detected: true,
      signal: "tone_directive",
      confidence: 0.98,
      requiresLLM: true,
    };
  }

  const deleteMatch = utterance.match(DELETE_DIRECTIVE);
  if (deleteMatch) {
    return {
      detected: true,
      signal: "delete_directive",
      confidence: 0.92,
      requiresLLM: true,
      marker: {
        start: deleteMatch.index ?? 0,
        end: (deleteMatch.index ?? 0) + deleteMatch[0].length,
      },
    };
  }

  const scratchMatch = utterance.match(SCRATCH_THAT);
  if (scratchMatch) {
    return {
      detected: true,
      signal: "scratch_that",
      confidence: 0.9,
      requiresLLM: true,
      marker: {
        start: scratchMatch.index ?? 0,
        end: (scratchMatch.index ?? 0) + scratchMatch[0].length,
      },
    };
  }

  const actuallyNoMatch = utterance.match(ACTUALLY_NO);
  if (actuallyNoMatch) {
    const safe = safeMarkerCandidate(utterance, actuallyNoMatch);
    return (
      safe ?? {
        detected: true,
        signal: "actually_no",
        confidence: 0.9,
        requiresLLM: true,
      }
    );
  }

  const doubleNoMatch = utterance.match(DOUBLE_NO);
  if (doubleNoMatch) {
    const safe = safeMarkerCandidate(utterance, doubleNoMatch);
    return (
      safe ?? {
        detected: true,
        signal: "double_no",
        confidence: 0.9,
        requiresLLM: true,
      }
    );
  }

  const singleNoMatch = utterance.match(SINGLE_NO);
  if (singleNoMatch) {
    return {
      detected: true,
      signal: "single_no",
      confidence: 0.7,
      requiresLLM: true,
      marker: {
        start: singleNoMatch.index ?? 0,
        end: (singleNoMatch.index ?? 0) + singleNoMatch[0].length,
      },
    };
  }

  const actuallyMatch = utterance.match(BARE_ACTUALLY);
  if (actuallyMatch) {
    const prefix = utterance.slice(0, actuallyMatch.index ?? 0);
    const wordsAfter = utterance
      .slice((actuallyMatch.index ?? 0) + actuallyMatch[0].length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const nearEnd = wordsAfter.length > 0 && wordsAfter.length <= 6;
    const hasClauseBoundary =
      /[.!?,]\s*$/.test(prefix) ||
      ((actuallyMatch.index ?? 0) === 0 && Boolean(args.committedBuffer?.trim()));
    return nearEnd && hasClauseBoundary
      ? {
          detected: true,
          signal: "bare_actually",
          confidence: 0.65,
          requiresLLM: true,
          marker: {
            start: actuallyMatch.index ?? 0,
            end:
              (actuallyMatch.index ?? 0) + actuallyMatch[0].length,
          },
        }
      : {
          detected: false,
          signal: "none",
          confidence: 0.9,
          requiresLLM: false,
          observation: "bare_actually_filtered",
        };
  }

  const revisionCue = utterance.match(REVISION_CUE);
  if (revisionCue) {
    return {
      detected: true,
      signal: "revision_cue",
      confidence: 0.65,
      requiresLLM: true,
      marker: {
        start: revisionCue.index ?? 0,
        end: (revisionCue.index ?? 0) + revisionCue[0].length,
      },
    };
  }

  return {
    detected: false,
    signal: "none",
    confidence: 1,
    requiresLLM: false,
  };
}
