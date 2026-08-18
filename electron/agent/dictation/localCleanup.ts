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

/** Cleanup layer only — fillers + stutters. No punctuation or capitalization. */
export function stripFillersAndStutters(text: string): string {
  let out = text.replace(FILLER_WORDS, " ");
  out = collapseStutters(out);
  return collapseSpaces(out);
}

/** Format layer only — spacing, capitalization, terminal punctuation. */
export function formatTranscript(text: string): string {
  return finishingTouches(tidyPunctuationSpacing(collapseSpaces(text)));
}

/** Baseline cleanup — cleanup + format composed. No LLM required. */
export function localCleanup(text: string): string {
  return formatTranscript(stripFillersAndStutters(text));
}

// --- Spoken list detection (Phase 7.1 "list" part) ---------------------

/** Strong ordinals — must see ≥2 of these at clause starts to format a list. */
const PRIMARY_ORDINAL =
  "first|firstly|second|secondly|third|thirdly|fourth|fourthly|fifth|fifthly";

/** Soft sequencers — only count after a primary ordinal already matched. */
const SOFT_SEQUENCER = "next|after that|finally|lastly";

const ANY_LIST_CUE_RE = new RegExp(
  `\\b(?:${PRIMARY_ORDINAL}|${SOFT_SEQUENCER})\\b[,:]?\\s*`,
  "gi",
);

export type SpokenList = { intro: string; items: string[] };

function wordCountLocal(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Cue must start a clause (after .!? or newline), not sit mid-phrase ("the first main issue"). */
function isListCueAtClauseStart(text: string, index: number): boolean {
  if (index <= 0) return true;
  const before = text.slice(0, index);
  return /[.!?;]\s*$/.test(before) || /\n\s*$/.test(before);
}

function isPrimaryOrdinalCue(matched: string): boolean {
  return new RegExp(`^(?:${PRIMARY_ORDINAL})\\b`, "i").test(matched.trim());
}

/**
 * Detect an explicit spoken list.
 * Requires ≥2 primary ordinals (first/second/…) at clause starts.
 * Rejects conversational mush that merely says "first … second … next …"
 * mid-sentence (live Instagram false positive 2026-08-08).
 */
export function detectSpokenList(text: string): SpokenList | null {
  const all = [...text.matchAll(ANY_LIST_CUE_RE)];
  if (all.length < 2) return null;

  const matches = all.filter((m) => isListCueAtClauseStart(text, m.index ?? 0));
  if (matches.length < 2) return null;

  const primaryCount = matches.filter((m) => isPrimaryOrdinalCue(m[0] ?? "")).length;
  if (primaryCount < 2) return null;

  const intro = text.slice(0, matches[0]!.index!).trim();
  const items: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index! + matches[i]![0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    const item = text.slice(start, end).trim().replace(/[.,;]+$/, "");
    if (item) items.push(item);
  }
  if (items.length < 2) return null;

  // Conversational paragraphs after "second" are not list items.
  const maxItemWords = Math.max(...items.map(wordCountLocal));
  if (maxItemWords > 28) return null;

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
