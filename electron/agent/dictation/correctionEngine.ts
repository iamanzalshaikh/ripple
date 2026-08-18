/**
 * P7.2 — Correction Understanding Engine (heuristics, no GPT required for v1).
 */

import type { StyleTone } from "../../storage/styleTone.js";

export type CorrectionKind =
  | "noop"
  | "replace_tail"
  | "delete_phrase"
  | "tone_rewrite"
  | "append";

export type CorrectionResult = {
  kind: CorrectionKind;
  text: string;
  detail?: string;
};

const NO_NO =
  /\b(?:no+\s*no+|nope|wait|actually|scratch that|i mean)\b/i;
const REMOVE =
  /\b(?:remove|delete|erase)\s+(.+?)\s*$/i;
const MAKE_VERY_CASUAL =
  /\b(?:make (?:it |this )?(?:very|super) casual|very casual)\b/i;
const MAKE_FORMAL =
  /\b(?:make (?:it |this )?(?:more |very )?formal|more formal|very formal)\b/i;
const MAKE_PROFESSIONAL =
  /\b(?:make (?:it |this )?(?:more )?professional|rewrite (?:it |this )?professionally)\b/i;
const MAKE_CASUAL =
  /\b(?:make (?:it |this )?casual|more casual|informal)\b/i;

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Soften filler / ASR noise before structural edits. */
function stripFillers(s: string): string {
  return collapseSpaces(
    s
      .replace(/\b(?:um+|uh+|erm+|like)\b/gi, " ")
      .replace(/\s+([,.!?])/g, "$1"),
  );
}

/**
 * Apply spoken revision intent to a revision buffer.
 * Example: "I want to meet you tomorrow. no no. day after tomorrow"
 *       → "I want to meet you the day after tomorrow"
 */
export function applyCorrectionHeuristics(
  bufferText: string,
  utterance?: string,
): CorrectionResult {
  const combined = collapseSpaces(
    utterance?.trim()
      ? bufferText.trim()
        ? `${bufferText.trim()} ${utterance.trim()}`
        : utterance.trim()
      : bufferText.trim(),
  );
  if (!combined) {
    return { kind: "noop", text: "" };
  }

  const spokenTone = parseSpokenStyleInstruction(combined);
  if (spokenTone && spokenTone !== "neutral") {
    const stripRe =
      spokenTone === "very_casual"
        ? MAKE_VERY_CASUAL
        : spokenTone === "formal"
          ? MAKE_FORMAL
          : spokenTone === "professional"
            ? MAKE_PROFESSIONAL
            : MAKE_CASUAL;
    const body = collapseSpaces(
      combined.replace(stripRe, " ").replace(NO_NO, " "),
    );
    return {
      kind: "tone_rewrite",
      text: applyStyleTone(body || bufferText, spokenTone),
      detail: spokenTone,
    };
  }

  const removeMatch = combined.match(REMOVE);
  if (removeMatch?.[1]) {
    const phrase = removeMatch[1].trim();
    const base = collapseSpaces(combined.replace(REMOVE, " "));
    const matches = [
      ...base.matchAll(new RegExp(escapeRegExp(phrase), "gi")),
    ];
    const last = matches.at(-1);
    const cleaned = last?.index === undefined
      ? base
      : collapseSpaces(
          base.slice(0, last.index) +
            base.slice(last.index + last[0].length),
        );
    return {
      kind: "delete_phrase",
      text: cleaned || stripFillers(base),
      detail: phrase,
    };
  }

  // Split on strong correction markers: "no no", "nope", "wait", "actually", "i mean"
  const marker =
    /\s*(?:,?\s*)?\b(?:no+\s*no+|nope|wait|actually|scratch that|i mean)\b\s*[.,:]?\s*/i;
  if (marker.test(combined)) {
    const parts = combined
      .split(marker)
      .map((p) => stripFillers(p))
      .filter(Boolean);

    if (parts.length >= 2) {
      const head = parts.slice(0, -1).join(" ");
      const tail = parts[parts.length - 1]!;
      const replaced = replaceOverlappingTail(head, tail);
      return {
        kind: "replace_tail",
        text: stripFillers(replaced),
        detail: tail,
      };
    }
  }

  // Natural single-"no" revision (Wispr-style spoken self-correct):
  //   "Meet tomorrow, no, day after tomorrow at 8"
  //   "Send the report Monday no Tuesday"
  //   "Call Rahul tomorrow no Friday"
  // Optional commas/punctuation around "no" (ASR often emits "no,").
  // Only rewrite when the tail clearly revises the head so idioms like
  // "money, no debt" stay untouched.
  const singleNo = /\s*(?:,\s*)?\bno\b(?!\s*no\b)\s*[.,:]?\s+/i;
  if (singleNo.test(combined)) {
    const parts = combined
      .split(singleNo)
      .map((p) => stripFillers(p.replace(/,$/, "")))
      .filter(Boolean);

    if (parts.length >= 2) {
      const head = parts.slice(0, -1).join(" ");
      const tail = parts[parts.length - 1]!;
      if (head && tail && tailRevisesHead(head, tail)) {
        return {
          kind: "replace_tail",
          text: stripFillers(replaceOverlappingTail(head, tail)),
          detail: tail,
        };
      }
    }
  }

  return { kind: "append", text: stripFillers(combined) };
}

const WEEKDAY =
  /(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i;

const TIME_OR_DAY =
  /(?:tomorrow|today|tonight|yesterday|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;

const REPLACEMENT_CLAUSE =
  /^(?:on\s+|the\s+)?(?:day\s+after\b|day\s+before\b|next\s+|this\s+|last\s+|(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|tomorrow\b|today\b|tonight\b|yesterday\b|at\s+\d)/i;

/** True when a post-"no" tail is a correction of the head (not a new clause). */
function tailRevisesHead(head: string, tail: string): boolean {
  if (REPLACEMENT_CLAUSE.test(tail)) return true;
  if (WEEKDAY.test(tail) && TIME_OR_DAY.test(head)) return true;
  if (sharedPhraseStartIndex(head, tail) >= 0) return true;
  const hWords = head.toLowerCase().split(/\s+/).filter(Boolean);
  const tWords = tail.toLowerCase().split(/\s+/).filter(Boolean);
  if (!hWords.length || !tWords.length) return false;
  const firstTail = tWords[0]!;
  return hWords.slice(-3).includes(firstTail);
}

/**
 * Find where a 2–4 word prefix of `tail` last appears in `head`.
 * Used for clause revisions: "just text me at 9 … no, just text me at 10".
 */
function sharedPhraseStartIndex(head: string, tail: string): number {
  const h = head.toLowerCase();
  const tWords = tail.toLowerCase().split(/\s+/).filter(Boolean);
  const max = Math.min(4, tWords.length);
  for (let n = max; n >= 2; n -= 1) {
    const phrase = tWords.slice(0, n).join(" ");
    const idx = h.lastIndexOf(phrase);
    if (idx >= 0) return idx;
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the overlapping ending of `head` with `tail`.
 * "meet you tomorrow" + "day after tomorrow" → "meet you the day after tomorrow"
 */
export function replaceOverlappingTail(head: string, tail: string): string {
  const h = collapseSpaces(head);
  const t = collapseSpaces(tail);
  if (!h) return t;
  if (!t) return h;

  const hWords = h.split(" ");
  const tWords = t.split(" ");

  // Clause revision via shared phrase start:
  // "… just text me at 9 o'clock" + "just text me at 10" → replace from "just…"
  const sharedIdx = sharedPhraseStartIndex(h, t);
  if (sharedIdx >= 0) {
    return collapseSpaces(h.slice(0, sharedIdx) + t);
  }

  // Prefer full-phrase rewrite when tail looks like a replacement clause.
  if (
    /^(?:on |the )?day after\b/i.test(t) ||
    /^(?:on |the )?day before\b/i.test(t) ||
    /^(?:next|this|last)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)\b/i.test(
      t,
    ) ||
    /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t)
  ) {
    // Drop trailing time/day words from head then append tail (normalize "the").
    const trimmedHead = h.replace(
      /\b(?:tomorrow|today|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+[^.!?]*)?$/i,
      "",
    );
    const prefix = collapseSpaces(trimmedHead);
    const clause = /^the\s+/i.test(t)
      ? t
      : /^(?:day after|day before|next|this|last)\b/i.test(t)
        ? `the ${t}`
        : t;
    // "on day after tomorrow" → "the day after tomorrow"
    const normalized = clause
      .replace(/^on\s+(?:the\s+)?day after/i, "the day after")
      .replace(/^on\s+(?:the\s+)?day before/i, "the day before")
      .replace(/^the\s+the\s+/i, "the ");
    return collapseSpaces(`${prefix} ${normalized}`);
  }

  // Longest overlapping suffix/prefix word match.
  let overlap = 0;
  const max = Math.min(hWords.length, tWords.length);
  for (let n = max; n >= 1; n -= 1) {
    const hSuffix = hWords.slice(-n).join(" ").toLowerCase();
    const tPrefix = tWords.slice(0, n).join(" ").toLowerCase();
    if (hSuffix === tPrefix) {
      overlap = n;
      break;
    }
  }

  if (overlap > 0) {
    return collapseSpaces(
      [...hWords.slice(0, -overlap), ...tWords].join(" "),
    );
  }

  // Drop last 1–3 head words if tail clearly revises them.
  if (hWords.length >= 2 && tWords.length >= 1) {
    return collapseSpaces([...hWords.slice(0, -1), ...tWords].join(" "))
      .replace(/\b(the|a|an)\s+\1\b/gi, "$1");
  }

  return collapseSpaces(`${h} ${t}`);
}

export function toProfessionalTone(text: string): string {
  let out = stripFillers(text);
  out = out.replace(/\bgotta\b/gi, "need to");
  out = out.replace(/\bwanna\b/gi, "would like to");
  out = out.replace(/\bhey\b/gi, "Hello");
  out = out.replace(/\bthanks\b/gi, "thank you");
  if (out && !/[.!?]$/.test(out)) out = `${out}.`;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function toCasualTone(text: string): string {
  return stripFillers(text).replace(/\bHello\b/g, "Hey");
}

/** Slack / chat: contractions and greetings, no forced period. */
export function toVeryCasualTone(text: string): string {
  let out = collapseSpaces(text);
  out = out.replace(/\bwould like to\b/gi, "wanna");
  out = stripFillers(out);
  out = out.replace(/\bHello\b/g, "Hey");
  out = out.replace(/\bHi\b/g, "Hey");
  out = out.replace(/\bneed to\b/gi, "gotta");
  out = out.replace(/\bthank you\b/gi, "thanks");
  out = out.replace(/\bI am\b/g, "I'm");
  out = out.replace(/\bdo not\b/gi, "don't");
  out = out.replace(/\bcannot\b/gi, "can't");
  return out;
}

/** Email / docs: expand slang and contractions. */
export function toFormalTone(text: string): string {
  let out = stripFillers(text);
  out = out.replace(/\bgonna\b/gi, "going to");
  out = out.replace(/\bgotta\b/gi, "must");
  out = out.replace(/\bwanna\b/gi, "would like to");
  out = out.replace(/\bhey\b/gi, "Hello");
  out = out.replace(/\bhi\b/gi, "Hello");
  out = out.replace(/\bthanks\b/gi, "thank you");
  out = out.replace(/\bcan't\b/gi, "cannot");
  out = out.replace(/\bdon't\b/gi, "do not");
  out = out.replace(/\bI'm\b/g, "I am");
  out = out.replace(/\bwe're\b/gi, "we are");
  out = out.replace(/\bit's\b/gi, "it is");
  if (out && !/[.!?]$/.test(out)) out = `${out}.`;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Map a spoken rewrite instruction to the Wispr scale.
 * Returns null when the utterance is not a tone command (Transforms keeps AI).
 */
export function parseSpokenStyleInstruction(
  instruction: string,
): StyleTone | null {
  const s = instruction.trim();
  if (!s) return null;
  if (MAKE_VERY_CASUAL.test(s) || /\bvery\s+casual\b|\bsuper\s+casual\b/i.test(s)) {
    return "very_casual";
  }
  if (MAKE_FORMAL.test(s) || /\b(?:more\s+|very\s+)?formal\b/i.test(s)) {
    return "formal";
  }
  if (MAKE_PROFESSIONAL.test(s) || /\bprofessional(?:ly)?\b|\bpolished\b/i.test(s)) {
    return "professional";
  }
  if (MAKE_CASUAL.test(s) || /\b(?:casual|informal|friendly)\b/i.test(s)) {
    return "casual";
  }
  return null;
}

/** Ambient per-app style. Neutral leaves text unchanged. */
export function applyStyleTone(text: string, tone: StyleTone): string {
  switch (tone) {
    case "very_casual":
      return toVeryCasualTone(text);
    case "casual":
      return toCasualTone(text);
    case "professional":
      return toProfessionalTone(text);
    case "formal":
      return toFormalTone(text);
    default:
      return text;
  }
}
