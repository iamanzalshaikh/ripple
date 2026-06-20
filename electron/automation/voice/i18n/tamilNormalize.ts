/**
 * Phase 4.7 — Tamil script → English slots (basic desktop verbs).
 */

import { containsTamil } from "./scriptDetect.js";

const PHRASE_MAP: [RegExp, string][] = [
  [/பதிவிறக்கம்\s*திற/gi, "open downloads"],
  [/என்\s*ரெசுமே\s*திற/gi, "open my resume"],
  [/வாட்ஸ்அப்\s*திற/gi, "open whatsapp"],
];

const WORD_MAP: [RegExp, string][] = [
  [/\bதிற\b/gu, "open"],
  [/\bகாட்டு\b/gu, "show"],
  [/\bஎன்\b/gu, "my"],
  [/\bமற்றும்\b/gu, "and"],
  [/\bபதிவிறக்கம்\b/gu, "downloads"],
  [/\bகோப்பு\b/gu, "file"],
  [/\bரெசுமே\b/gu, "resume"],
  [/\bவாட்ஸ்அப்\b/gu, "whatsapp"],
  [/\bதேடு\b/gu, "search"],
];

export function normalizeTamil(text: string): string {
  if (!containsTamil(text)) return text;

  let s = text.trim().replace(/\s+/g, " ");
  for (const [re, rep] of PHRASE_MAP) s = s.replace(re, rep);
  for (const [re, rep] of WORD_MAP) s = s.replace(re, rep);

  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s.trim();
}
