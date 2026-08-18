/**
 * Wispr-style per-app tone scale: Very Casual → Formal.
 * Storage + IPC share this list. Rewrite helpers live in correctionEngine.
 *
 * Legacy rows (`professional` / `casual` / `neutral`) stay valid — they are
 * points on this scale, not a separate system.
 */

export const STYLE_TONE_SCALE = [
  "very_casual",
  "casual",
  "neutral",
  "professional",
  "formal",
] as const;

export type StyleTone = (typeof STYLE_TONE_SCALE)[number];

export const STYLE_TONE_LABELS: Record<StyleTone, string> = {
  very_casual: "Very Casual",
  casual: "Casual",
  neutral: "Neutral",
  professional: "Professional",
  formal: "Formal",
};

const TONE_SET = new Set<string>(STYLE_TONE_SCALE);

export function isStyleTone(value: string): value is StyleTone {
  return TONE_SET.has(value);
}

/** Unknown / empty → Neutral (as-spoken, no override). */
export function parseStyleTone(value?: string | null): StyleTone {
  const key = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (isStyleTone(key)) return key;
  if (key === "verycasual") return "very_casual";
  return "neutral";
}
