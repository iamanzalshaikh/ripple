import type {
  CorrectionDecision,
  DictationGeneration,
  SignalDetection,
} from "./dictationCorrectionTypes.js";

const THRESHOLDS: Record<CorrectionDecision["type"], number> = {
  replace: 0.75,
  append: 0.7,
  delete: 0.85,
  tone_change: 0.8,
  rewrite: 0.8,
  none: 1,
};

export type SafeApplyResult = {
  applied: boolean;
  text: string;
  dropped: string[];
  reason: string;
};

function replaceLast(text: string, original: string, replacement: string): string {
  const index = text.lastIndexOf(original);
  if (index < 0) return text;
  return (
    text.slice(0, index) +
    replacement +
    text.slice(index + original.length)
  );
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasUnexplainedLengthDrop(args: {
  before: string;
  after: string;
  decision: CorrectionDecision;
  generation?: DictationGeneration | null;
}): boolean {
  const beforeWords = words(args.before);
  const afterWords = words(args.after);
  if (beforeWords === 0 || afterWords >= beforeWords * 0.6) return false;
  // Short correction utterances often shrink a lot after dropping scaffolding.
  if (
    (args.decision.type === "replace" || args.decision.type === "delete") &&
    args.decision.original &&
    beforeWords <= 10
  ) {
    return false;
  }
  if (args.decision.type === "delete" && args.decision.original) return false;
  if (args.decision.type === "replace" && args.decision.original) {
    const replacement = args.decision.replacement?.trim();
    // Long utterances may still shrink (markers + restatement), but not down to
    // a stub that drops most unique content.
    if (
      replacement &&
      args.after.toLowerCase().includes(replacement.toLowerCase()) &&
      afterWords >= Math.max(4, Math.floor(beforeWords * 0.35))
    ) {
      return false;
    }
  }
  return !(args.generation?.droppedContent?.length);
}

const TAIL_FILLER =
  /^(?:(?:wait|actually|sorry(?:\s+make\s+that)?|just|uh|um|rather|instead|no)\b[,.\s]*)+/i;

function stripLeadingCorrectionFillers(tail: string): string {
  let rest = tail.trim();
  for (let i = 0; i < 4; i += 1) {
    const next = rest.replace(TAIL_FILLER, "").trim();
    if (next === rest) break;
    rest = next;
  }
  return rest;
}

function indexOfIgnoreCase(haystack: string, needle: string): number {
  if (!needle) return -1;
  return haystack.toLowerCase().lastIndexOf(needle.toLowerCase());
}

function continuationAfterToken(rest: string, token: string): string | null {
  const idx = indexOfIgnoreCase(rest, token);
  if (idx < 0) return null;
  return rest.slice(idx + token.length).replace(/^[,.\s]+/, "").trim();
}

function isLikelyRestatement(correctedHead: string, rest: string): boolean {
  const headTokens = new Set(
    correctedHead
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const restTokens = rest
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (restTokens.length === 0) return true;
  const overlap = restTokens.filter((t) => headTokens.has(t)).length;
  return overlap / restTokens.length >= 0.6;
}

/**
 * Apply a replace decision to raw speech while removing the spoken correction
 * marker and duplicate restatement — but keep genuine continuation after the
 * corrected phrase (e.g. "because I have some work…").
 */
function applyMarkerReplace(args: {
  utterance: string;
  signal: SignalDetection;
  original: string;
  replacement: string;
}): string | null {
  const marker = args.signal.marker;
  if (!marker) return null;

  const head = args.utterance
    .slice(0, marker.start)
    .replace(/[,\s]+$/, "")
    .trim();
  const tail = args.utterance
    .slice(marker.end)
    .replace(/^[,\s]+/, "")
    .trim();
  if (!head.includes(args.original)) return null;

  const normalizedReplacement =
    /^day (?:after|before)\b/i.test(args.replacement) &&
    !/^the\s+/i.test(args.replacement)
      ? `the ${args.replacement}`
      : args.replacement;
  const correctedHead = replaceLast(
    head,
    args.original,
    normalizedReplacement,
  );
  const rest = stripLeadingCorrectionFillers(tail);
  const tailReplacement =
    normalizedReplacement.startsWith("the ") &&
    rest.toLowerCase().startsWith(normalizedReplacement.slice(4).toLowerCase())
      ? normalizedReplacement.slice(4)
      : normalizedReplacement;

  if (rest.toLowerCase().startsWith(tailReplacement.toLowerCase())) {
    const suffix = rest.slice(tailReplacement.length).replace(/^[,.\s]+/, "").trim();
    return [correctedHead, suffix].filter(Boolean).join(" ").trim();
  }

  const afterToken =
    continuationAfterToken(rest, tailReplacement) ??
    continuationAfterToken(rest, normalizedReplacement);
  if (afterToken !== null) {
    return [correctedHead, afterToken].filter(Boolean).join(" ").trim();
  }

  if (!rest) return correctedHead;
  if (isLikelyRestatement(correctedHead, rest)) return correctedHead;
  return [correctedHead, rest].filter(Boolean).join(" ").trim();
}

export function applyCorrectionDecision(args: {
  committedBuffer: string;
  currentUtterance: string;
  signal: SignalDetection;
  decision: CorrectionDecision;
  generation?: DictationGeneration | null;
}): SafeApplyResult {
  const literal = args.currentUtterance.trim();
  const decision = args.decision;

  if (!decision.isCorrection || decision.type === "none") {
    return { applied: false, text: literal, dropped: [], reason: "not_correction" };
  }

  if (decision.confidence < THRESHOLDS[decision.type]) {
    return {
      applied: false,
      text: literal,
      dropped: [],
      reason: "below_confidence_threshold",
    };
  }

  let result: string | null = null;
  let before = literal;
  const dropped: string[] = [];

  if (decision.type === "replace") {
    if (!decision.original || !decision.replacement) {
      return {
        applied: false,
        text: literal,
        dropped,
        reason: "missing_replace_fields",
      };
    }

    result = applyMarkerReplace({
      utterance: literal,
      signal: args.signal,
      original: decision.original,
      replacement: decision.replacement,
    });

    if (!result && literal.includes(decision.original)) {
      result = replaceLast(literal, decision.original, decision.replacement);
    } else if (!result && args.committedBuffer.includes(decision.original)) {
      before = args.committedBuffer;
      result = replaceLast(
        args.committedBuffer,
        decision.original,
        decision.replacement,
      );
    }
    if (!result) {
      return {
        applied: false,
        text: literal,
        dropped,
        reason: "original_not_found_in_buffer",
      };
    }
    dropped.push(decision.original);
  } else if (decision.type === "delete") {
    const target = decision.original?.trim();
    if (target && literal.includes(target)) {
      result = replaceLast(literal, target, "").replace(/\s+/g, " ").trim();
      dropped.push(target);
    } else if (target && args.committedBuffer.includes(target)) {
      before = args.committedBuffer;
      result = replaceLast(args.committedBuffer, target, "")
        .replace(/\s+/g, " ")
        .trim();
      dropped.push(target);
    } else if (decision.scope === "sentence" && args.committedBuffer.trim()) {
      before = args.committedBuffer.trim();
      const match = before.match(/(?:^|[.!?]\s+)([^.!?]+[.!?]?)\s*$/);
      if (match?.[1]) {
        result = before.slice(0, before.length - match[1].length).trim();
        dropped.push(match[1]);
      }
    }
    if (result === null) {
      return {
        applied: false,
        text: literal,
        dropped,
        reason: "original_not_found_in_buffer",
      };
    }
  } else if (decision.type === "append") {
    if (!decision.replacement) {
      return {
        applied: false,
        text: literal,
        dropped,
        reason: "missing_append_text",
      };
    }
    before = args.committedBuffer.trim();
    result = [before, decision.replacement].filter(Boolean).join(" ").trim();
  } else {
    before = args.committedBuffer.trim() || literal;
    result = args.generation?.generatedText?.trim() || null;
    if (!result) {
      return {
        applied: false,
        text: literal,
        dropped,
        reason: "generator_unavailable",
      };
    }
    dropped.push(...(args.generation?.droppedContent ?? []));
  }

  if (
    hasUnexplainedLengthDrop({
      before,
      after: result,
      decision,
      generation: args.generation,
    })
  ) {
    return {
      applied: false,
      text: literal,
      dropped,
      reason: "unexplained_length_drop",
    };
  }

  return { applied: true, text: result, dropped, reason: "applied" };
}
