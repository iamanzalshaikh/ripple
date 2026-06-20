/**
 * Phase 4.7 — detect non-Latin script families for NLU routing.
 */

export type ScriptFamily =
  | "latin"
  | "devanagari"
  | "arabic"
  | "sinhala"
  | "tamil"
  | "bengali"
  | "other";

export function containsDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

export function containsArabicScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(text);
}

export function containsSinhala(text: string): boolean {
  return /[\u0D80-\u0DFF]/.test(text);
}

export function containsTamil(text: string): boolean {
  return /[\u0B80-\u0BFF]/.test(text);
}

export function containsBengali(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text);
}

export function detectPrimaryScript(text: string): ScriptFamily {
  if (containsDevanagari(text)) return "devanagari";
  if (containsArabicScript(text)) return "arabic";
  if (containsSinhala(text)) return "sinhala";
  if (containsTamil(text)) return "tamil";
  if (containsBengali(text)) return "bengali";
  if (/[^\u0000-\u007F]/.test(text)) return "other";
  return "latin";
}

/** True when speech is in a regional script we normalize before English parsers. */
export function hasRegionalScript(text: string): boolean {
  const s = detectPrimaryScript(text);
  return s !== "latin" && s !== "other";
}

/** Block blind backend routing for Indic / Sinhala / Tamil desktop-shaped speech. */
export function isRegionalDesktopScript(text: string): boolean {
  return (
    containsDevanagari(text) ||
    containsArabicScript(text) ||
    containsSinhala(text) ||
    containsTamil(text) ||
    containsBengali(text)
  );
}
