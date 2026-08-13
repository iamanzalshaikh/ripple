/**
 * Soft self-correction class detector (production).
 *
 * Additive only — does NOT replace Layer-1 surgical signals (double_no, etc.).
 * Does NOT auto-delete phrases locally.
 *
 * When a soft revision cue appears mid-utterance with real content before AND
 * after, cleanupWithinBounds may relax so AI dictation_clean can keep final
 * intent (e.g. "…notes Sorry, …wallet" → wallet only).
 *
 * Ordinary apologies ("Sorry I'm late") stay undetected → strict bounds.
 */

/** Soft revision cue class — not a closed per-product word filter. */
const SOFT_REVISION_CUE =
  /\b(?:(?:oh|um|uh|ah)\s+)?(?:sorry|oops|my\s+bad|i\s+meant|i\s+mean|wait|actually|instead|scratch\s+that|no\s+wait)\b/i;

export type SoftSelfCorrectionHit = {
  detected: boolean;
  reason: string;
  cue: string | null;
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * True when the utterance likely contains a mid-speech revision
 * (content → soft cue → replacement content), not a standalone apology.
 */
export function detectSoftSelfCorrection(
  utterance: string,
): SoftSelfCorrectionHit {
  const text = utterance.trim();
  if (!text) {
    return { detected: false, reason: "empty", cue: null };
  }

  const match = SOFT_REVISION_CUE.exec(text);
  if (!match || match.index == null) {
    return { detected: false, reason: "none", cue: null };
  }

  const cue = match[0].trim();
  const before = text.slice(0, match.index).trim();
  const after = text.slice(match.index + match[0].length).trim();

  // Standalone / leading apology — do not unlock aggressive cleanup.
  if (wordCount(before) < 3) {
    return {
      detected: false,
      reason: "cue_too_early_apology",
      cue,
    };
  }

  // Cue with no replacement content — nothing to collapse to.
  if (wordCount(after) < 3) {
    return {
      detected: false,
      reason: "cue_without_replacement",
      cue,
    };
  }

  return {
    detected: true,
    reason: `soft_revision:${cue.toLowerCase()}`,
    cue,
  };
}
