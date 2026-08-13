/**
 * Soft detector for competing alternatives in one utterance.
 *
 * Additive only — does NOT replace Layer-1 correction signals (double_no, etc.).
 * Used to relax cleanupWithinBounds so the existing AI dictation_clean pass can
 * keep the final intent (e.g. Good Morning + Good Afternoon → one greeting).
 *
 * Production soft guard: altCollapseIsPlausible rejects only clearly failed
 * collapses (still jammed). It does NOT force "last wins" in code — AI chooses.
 */

const TOD_GREETING =
  /\bgood\s+(morning|afternoon|evening|night)\b/gi;

/** Clock-ish times: 9, 9pm, 9 o'clock, 10:30 am */
const CLOCK_TIME =
  /\b(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|o['']?clock)|(?:at|by)\s+\d{1,2}(?::\d{2})?)\b/gi;

/** Repeated offer / ask stems — "can we …, can we …" */
const OFFER_STEM = /\b(?:can\s+we|could\s+we|shall\s+we|let'?s)\b/gi;

/** Range / choice merge — "9–10", "9 or 10", "9 to 10" */
const TIME_RANGE_MERGE = /[-–—]|\/|\bor\b|\bto\b/i;

export type IntentAlternativeKind =
  | "greeting_tod"
  | "clock_times"
  | "repeated_offer"
  | null;

export type IntentAlternativesHit = {
  detected: boolean;
  kind: IntentAlternativeKind;
  reason: string;
};

function uniqueNormalized(matches: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const key = m.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function countTodGreetings(text: string): number {
  return uniqueNormalized(
    [...text.matchAll(TOD_GREETING)].map((m) => m[0]),
  ).length;
}

export function countClockTimes(text: string): number {
  return uniqueNormalized(
    [...text.matchAll(CLOCK_TIME)].map((m) => m[0]),
  ).length;
}

export function countOfferStems(text: string): number {
  return [...text.matchAll(OFFER_STEM)].length;
}

/**
 * Returns true when the utterance likely contains competing alternatives
 * that a Wispr-style cleanup should collapse to final intent — without
 * requiring an explicit "no no" marker.
 */
export function detectIntentAlternatives(utterance: string): IntentAlternativesHit {
  const text = utterance.trim();
  if (!text) {
    return { detected: false, kind: null, reason: "empty" };
  }

  const greetings = uniqueNormalized(
    [...text.matchAll(TOD_GREETING)].map((m) => m[0]),
  );
  if (greetings.length >= 2) {
    return {
      detected: true,
      kind: "greeting_tod",
      reason: `competing_tod_greetings:${greetings.join("|")}`,
    };
  }

  const times = uniqueNormalized(
    [...text.matchAll(CLOCK_TIME)].map((m) => m[0]),
  );
  if (times.length >= 2) {
    return {
      detected: true,
      kind: "clock_times",
      reason: `competing_clock_times:${times.join("|")}`,
    };
  }

  const offers = [...text.matchAll(OFFER_STEM)];
  if (offers.length >= 2) {
    return {
      detected: true,
      kind: "repeated_offer",
      reason: `repeated_offer_stems:${offers.length}`,
    };
  }

  return { detected: false, kind: null, reason: "none" };
}

/**
 * Soft production guard after AI cleanup when alternatives were detected.
 *
 * Pass = AI reduced the jam (or merged times into a range).
 * Fail = still clearly jammed → caller falls back to localCleanup.
 *
 * Intentionally NOT strict: does not require "exactly last", does not
 * demand a single remaining token, does not touch Layer-1.
 */
export function altCollapseIsPlausible(
  before: string,
  after: string,
  kind: IntentAlternativeKind,
): boolean {
  const src = before.trim();
  const cleaned = after.trim();
  if (!cleaned) return false;
  if (!kind) return true;

  if (kind === "greeting_tod") {
    const b = countTodGreetings(src);
    const a = countTodGreetings(cleaned);
    // Must reduce competing TOD greetings (0 or 1 left is fine).
    return a < b;
  }

  if (kind === "clock_times") {
    const b = countClockTimes(src);
    const a = countClockTimes(cleaned);
    if (a < b) return true;
    // "9 or 10" / "9–10 pm" still has two clock hits but is a cleaned ask.
    if (a <= b && TIME_RANGE_MERGE.test(cleaned) && cleaned.length <= src.length) {
      return true;
    }
    return false;
  }

  if (kind === "repeated_offer") {
    const b = countOfferStems(src);
    const a = countOfferStems(cleaned);
    if (a < b) return true;
    // Single cleaned ask may keep one "can we" — allow if noticeably shorter.
    if (a <= b && cleaned.length <= Math.floor(src.length * 0.92)) {
      return true;
    }
    return false;
  }

  return true;
}
