import type {
  CorrectionDecision,
  SignalDetection,
} from "./dictationCorrectionTypes.js";

const IDIOMATIC_NO =
  /^(?:no problem|no worries|no chance|no idea|no thanks)\b/i;
const TONE_DIRECTIVE =
  /\b(?:make (?:it|this|that)?\s*(?:more\s+|very\s+|super\s+)?(?:professional|formal|casual|friendly|shorter|longer)|rewrite|rephrase)\b/i;
const DELETE_DIRECTIVE =
  /\b(?:delete|remove|erase)\s+(?:the\s+)?(?:last\s+(?:sentence|part|phrase)|that\s+(?:sentence|part|phrase)|(?:word|phrase)\s+.+)$/i;
const SCRATCH_THAT = /\bscratch\s+that\b/i;
const ACTUALLY_NO = /\b(?:actually\s*[,.]?\s*no|no\s*[,.]?\s*actually)\b/i;
const DOUBLE_NO = /\bno+\s*[,.]?\s*no+\b/i;
const SINGLE_NO = /\bno\b/i;
/**
 * The comma-delimited retraction form only — "meet at 9pm, no, 10pm".
 * A bare `no` ("there is no 3pm option") is ordinary speech, not a correction
 * marker, so it must never be resolved locally into a temporal swap.
 */
const SINGLE_NO_CORRECTION = /(?:^|,)\s*no\s*,/i;

/**
 * `no` used as a negative determiner or fixed idiom — "no problem", "no way",
 * "no one", "no longer". Never a retraction, wherever it appears in the
 * sentence. (The older IDIOMATIC_NO only matched at the START of the utterance,
 * which is why a mid-sentence "no" sailed through to the LLM.)
 */
const NO_IDIOM_HEAD =
  /^(?:problem|worries|idea|thanks|chance|way|one|longer|matter|doubt|need|point|sense|clue|comment)\b/i;

/** Explicit spoken repair cues that legitimately follow a retraction "no". */
const NO_REPAIR_CUE = /^\s+(?:wait|sorry|actually|scratch|i\s+mean)\b/i;

/**
 * A temporal token sitting at the very END of the text before the `no`. This is
 * the adjacency test that separates "meeting is monday| no tuesday" (retraction)
 * from "at 2pm there is| no 3pm option" (determiner negating a noun).
 */
const TEMPORAL_AT_END =
  /\b(?:day after tomorrow|day before yesterday|tomorrow|today|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm|o'clock)?)\s*,?\s*$/i;

/**
 * Decide whether ANY `no` in the utterance is actually a retraction marker,
 * and return where it starts. Returns null when every `no` is ordinary speech.
 *
 * This is the production filter. Live 2026-08-20 showed the cost of not having
 * it: "…suppose if there is no Stack, it will show no Stack…" was classified
 * `single_no`, which forced a Layer2a call that burned **3106 ms** only to
 * conclude "'no Stack' … is a normal sentence meaning" — plus a 1.2 s aborted
 * rewrite on top.
 *
 * A retraction "no" is delimited by a pause (comma), or introduces an explicit
 * repair cue, or sits between two same-category restatements. A determiner "no"
 * attaches directly to the noun it negates and never takes a comma.
 */
function retractionNoIndex(utterance: string): number | null {
  const re = /\bno\b/gi;
  let match: RegExpExecArray | null = re.exec(utterance);
  while (match !== null) {
    const start = match.index;
    const after = utterance.slice(start + match[0].length);
    const before = utterance.slice(0, start);
    const afterTrimmed = after.replace(/^\s+/, "");

    const idiom = NO_IDIOM_HEAD.test(afterTrimmed);
    if (!idiom) {
      // "…, no" / "no, …" — a pause around it marks a retraction.
      if (/,\s*$/.test(before) || /^\s*,/.test(after)) return start;
      // "no wait", "no sorry", "no I mean" — explicit repair.
      if (NO_REPAIR_CUE.test(after)) return start;
      // "meeting is Monday no Tuesday" — same-category restatement on both
      // sides is a retraction even without a comma.
      //
      // Adjacency is what separates it from a determiner: a retraction corrects
      // the thing it immediately follows, so the temporal sits at the very end
      // of the preceding clause ("…is monday| no tuesday"). In "at 2pm there is
      // no 3pm option" the temporal is far to the left with "there is" between,
      // which marks "no" as negating the noun, not retracting the time.
      if (
        TEMPORAL_AT_END.test(before) &&
        lastTemporal(afterTrimmed.slice(0, 60))
      ) {
        return start;
      }
    }
    // Otherwise this `no` is a negative determiner ("there is no stack",
    // "we have no slots") — not a correction. Keep scanning the rest.
    match = re.exec(utterance);
  }
  return null;
}
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
  const retractionAt = retractionNoIndex(utterance);
  if (singleNoMatch && retractionAt === null) {
    // Every `no` in this utterance is ordinary speech. Treating it as a
    // correction signal is what cost 3.1 s of LLM time per dictation.
    return {
      detected: false,
      signal: "none",
      confidence: 0.97,
      requiresLLM: false,
      observation: "determiner_no_filtered",
    };
  }
  if (singleNoMatch) {
    // Latency #3 — an unambiguous temporal swap is resolved locally instead of
    // paying a Layer2a round trip that historically still left "no 10 pm" in
    // the final text.
    //
    // Anchored on the SAME retraction position the filter already identified.
    // The earlier `SINGLE_NO_CORRECTION` gate demanded a comma on both sides
    // (", no,"), but real speech is "at 9, no 10 pm" — comma only before — so
    // every genuine correction fell through to the LLM, which then spent
    // 1.9–4.1 s (live 2026-08-20) and returned no replacement at all.
    //
    // safeMarkerCandidate still requires a temporal token on BOTH sides and a
    // short tail, so ordinary speech cannot be rewritten by accident.
    const marker = Object.assign(["no"], {
      index: retractionAt ?? singleNoMatch.index ?? 0,
    }) as unknown as RegExpMatchArray;
    const safe = safeMarkerCandidate(utterance, marker);
    if (safe) {
      return { ...safe, signal: "single_no", confidence: 0.9 };
    }
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
