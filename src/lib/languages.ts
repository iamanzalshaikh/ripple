/**
 * P9.5 / P11.2 — shared dictation language list. Used by both the full
 * Language settings page and the compact Flow Bar picker so the two never
 * drift apart. "auto" (default) sends no language hint — Whisper auto-detects.
 */
export type LanguageOption = { code: string; label: string };

export const LANGUAGES: LanguageOption[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" },
  { code: "ta", label: "Tamil" },
  { code: "si", label: "Sinhala" },
  { code: "bn", label: "Bengali" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ru", label: "Russian" },
];

/** Short badge text for the Flow Bar (e.g. "AUTO", "HI"). */
export function languageBadgeCode(code: string): string {
  return code === "auto" ? "AUTO" : code.toUpperCase();
}
