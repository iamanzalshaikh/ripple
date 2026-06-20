/**
 * Phase 4.7 — Urdu / Arabic script phrase → English slots.
 */

import { containsArabicScript } from "./scriptDetect.js";

export { containsArabicScript };

const PHRASE_MAP: [RegExp, string][] = [
  [/میرا\s*ریزیوم\s*کھولو/gi, "open my resume"],
  [/میری\s*ریزیوم\s*کھولو/gi, "open my resume"],
  [/ڈاؤن\s*لوڈ\s*کھولو/gi, "open downloads"],
  [/ڈاؤنلوڈ\s*کھولو/gi, "open downloads"],
  [/ڈاؤنلوڈ\s*کھولو\s*اور\s*میرا\s*ریزیوم\s*کھولو/gi, "open downloads and open my resume"],
  [/کل\s*والی\s*فائل/gi, "open yesterday file"],
  [/کل\s*کی\s*پی\s*ڈی\s*ایف\s*کھولو/gi, "open yesterday pdf"],
  [/واٹس\s*ایپ\s*کھولو/gi, "open whatsapp"],
  [/واٹساپ\s*کھولو/gi, "open whatsapp"],
  [/دوبارہ\s*کھولو/gi, "open it again"],
  [/دستاویزات\s*کھولو/gi, "open documents"],
  [/ڈیسک\s*ٹاپ\s*کھولو/gi, "open desktop"],
  [/نیا\s*فولڈر.*?ڈاکومنٹس/gi, "create folder in documents, named folder"],
  [/فولڈر\s*بناؤ/gi, "create folder"],
  [/ڈیلیٹ\s*کرو/gi, "delete"],
  [/موو\s*کرو/gi, "move"],
];

const WORD_MAP: [RegExp, string][] = [
  [/\bکھولو\b/gu, "open"],
  [/\bکھول\b/gu, "open"],
  [/\bدکھاؤ\b/gu, "show"],
  [/\bبھیجو\b/gu, "send"],
  [/\bمیرا\b/gu, "my"],
  [/\bمیری\b/gu, "my"],
  [/\bاور\b/gu, "and"],
  [/\bکل\b/gu, "yesterday"],
  [/\bآج\b/gu, "today"],
  [/\bفائل\b/gu, "file"],
  [/\bریزیوم\b/gu, "resume"],
  [/\bڈاؤن\s*لوڈ\b/gu, "downloads"],
  [/\bڈاؤنلوڈ\b/gu, "downloads"],
  [/\bواٹس\s*ایپ\b/gu, "whatsapp"],
  [/\bواٹساپ\b/gu, "whatsapp"],
  [/\bدوبارہ\b/gu, "again"],
  [/\bتلاش\b/gu, "search"],
  [/\bڈاکٹر\b/gu, "Dr"],
];

export function normalizeUrdu(text: string): string {
  if (!containsArabicScript(text)) return text;

  let s = text.trim().replace(/\s+/g, " ");
  for (const [re, rep] of PHRASE_MAP) {
    s = s.replace(re, rep);
  }
  for (const [re, rep] of WORD_MAP) {
    s = s.replace(re, rep);
  }

  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s.trim();
}
