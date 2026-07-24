/**
 * Wispr-Flow plan Phase 7.1 — local, deterministic filler/punct/list cleanup.
 *
 * The only cleanup path before this was aiRewriteDictation() — one LLM call
 * to the backend, fail-open to the completely raw transcript on any network/
 * auth/timeout failure. That meant offline (or slow/unauthenticated) users
 * got zero cleanup at all: every "um", stutter, and missing terminal period
 * went straight to the field. This module runs locally, always, regardless
 * of backend availability.
 */

const FILLER_WORDS =
  /\b(?:um+|uh+|erm+|uhh+|umm+|like|you know|sort of|kind of|basically|literally)\b,?/gi;

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Collapse immediate stutter repeats: "the the report" -> "the report".
 * Whisper often renders a stutter with a comma between repeats ("what, what,
 * what is it") rather than plain whitespace — the optional `,?` before the
 * required whitespace catches that form too without changing the plain-space
 * case at all.
 */
function collapseStutters(s: string): string {
  return s.replace(/\b(\w+)(?:,?\s+\1\b)+/gi, "$1");
}

function tidyPunctuationSpacing(s: string): string {
  return s.replace(/\s+([,.!?])/g, "$1");
}

/** Capitalize first letter and ensure terminal punctuation. */
function finishingTouches(s: string): string {
  let out = s.trim();
  if (!out) return out;
  const isQuestion = /^(?:who|what|when|where|why|how|is|are|can|could|will|would|do|does|did)\b/i.test(
    out,
  );
  if (!/[.!?]$/.test(out)) {
    out = `${out}${isQuestion ? "?" : "."}`;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Baseline cleanup — always safe, always applied, no LLM required. */
export function localCleanup(text: string): string {
  let out = text;
  out = out.replace(FILLER_WORDS, " ");
  out = collapseStutters(out);
  out = collapseSpaces(out);
  out = tidyPunctuationSpacing(out);
  out = finishingTouches(out);
  return out;
}

// --- Spoken list detection (Phase 7.1 "list" part) ---------------------

const LIST_CUE =
  "first|firstly|second|secondly|third|thirdly|fourth|fourthly|fifth|next|after that|finally|lastly";
const LIST_CUE_RE = new RegExp(`\\b(?:${LIST_CUE})\\b[,:]?\\s*`, "gi");

export type SpokenList = { intro: string; items: string[] };

/**
 * Detect an explicit spoken list. Requires >= 2 ordinal/sequence cues so
 * ordinary sentences that happen to contain "next" or "first" once aren't
 * misread as a list.
 */
export function detectSpokenList(text: string): SpokenList | null {
  const matches = [...text.matchAll(LIST_CUE_RE)];
  if (matches.length < 2) return null;

  const intro = text.slice(0, matches[0]!.index!).trim();
  const items: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index! + matches[i]![0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    const item = text.slice(start, end).trim().replace(/[.,;]+$/, "");
    if (item) items.push(item);
  }
  if (items.length < 2) return null;
  return { intro, items };
}

export function formatSpokenList(list: SpokenList): string {
  const lines = list.items.map((item, i) => {
    const cap = item.charAt(0).toUpperCase() + item.slice(1);
    const withEnd = /[.!?]$/.test(cap) ? cap : `${cap}.`;
    return `${i + 1}. ${withEnd}`;
  });
  return list.intro ? `${finishingTouches(list.intro)}\n${lines.join("\n")}` : lines.join("\n");
}
