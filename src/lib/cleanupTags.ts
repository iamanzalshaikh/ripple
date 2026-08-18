/**
 * Overlay-only: infer which Wispr-style chips to show.
 * Does not run cleanup, rewrite, insert, or focus — display from text we already have.
 */

export type CleanupTag = "filler" | "correction" | "repetition";

const FILLER_RE =
  /\b(?:um+|uh+|erm+|uhh+|umm+|like|you know|sort of|kind of|basically|literally)\b/i;

const STUTTER_RE = /\b(\w+)(?:,?\s+\1\b)+/i;

const CORRECTION_SPEECH_RE =
  /\b(?:no+\s*no+|scratch that|i mean|wait no|actually)\b/i;

const CORRECTION_KINDS = new Set([
  "double_no",
  "scratch_that",
  "delete_directive",
  "actually_no",
  "single_no",
  "revision_cue",
  "replace",
  "delete",
  "rewrite",
  "replace_tail",
  "delete_phrase",
  "tone_rewrite",
  "tone_change",
]);

export function inferCleanupTags(args: {
  original?: string;
  final?: string;
  correctionKind?: string;
}): CleanupTag[] {
  const original = (args.original ?? "").trim();
  const tags: CleanupTag[] = [];
  if (!original) return tags;

  if (FILLER_RE.test(original)) tags.push("filler");
  if (STUTTER_RE.test(original)) tags.push("repetition");

  const kind = (args.correctionKind ?? "").trim().toLowerCase();
  if (CORRECTION_KINDS.has(kind) || CORRECTION_SPEECH_RE.test(original)) {
    tags.push("correction");
  }

  return tags;
}

export const CLEANUP_TAG_LABEL: Record<CleanupTag, string> = {
  filler: "Filler identified",
  correction: "Correction identified",
  repetition: "Repetition identified",
};
