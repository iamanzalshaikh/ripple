/**
 * Phase 4.7 — Urdu / Arabic script + Roman Urdu phrase → English slots.
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
  [/کل\s*والی\s*تصویر\s*کھولو/gi, "open yesterday image"],
  [/کل\s*والا\s*ویڈیو\s*کھولو/gi, "open yesterday video"],
  [/کل\s*والا\s*فولڈر\s*کھولو/gi, "open yesterday folder"],
  [/کل\s*کی\s*پی\s*ڈی\s*ایف\s*کھولو/gi, "open yesterday pdf"],
  [/واٹس\s*ایپ\s*کھولو/gi, "open whatsapp"],
  [/واٹساپ\s*کھولو/gi, "open whatsapp"],
  [/دوبارہ\s*کھولو/gi, "open it again"],
  [/دستاویزات\s*کھولو/gi, "open documents"],
  [/ڈیسک\s*ٹاپ\s*کھولو/gi, "open desktop"],
  [/نیا\s*فولڈر.*?ڈاکومنٹس/gi, "create folder in documents, named folder"],
  [/سرچ\s+ڈاکٹر\s*فاطم\w*/gi, "search Dr. Fatima on WhatsApp and ask"],
  [/تلاش\s+ڈاکٹر\s*فاطم\w*/gi, "search Dr. Fatima on WhatsApp and ask"],
  [/ڈیلیٹ\s*کرو/gi, "delete"],
  [/موو\s*کرو/gi, "move"],
];

/** Urdu/Arabic-script editor commands — STT transliterations of English edit keys. */
const URDU_EDIT_PHRASE_MAP: [RegExp, string][] = [
  [
    /س[یيئ]?ل[یيئ]?ک[ٹت]?\s+(?:اول|ال)\s+(?:ا[یيئ]?ن[ڈد]?|اینڈ|ایند)\s+کاپ[یيئ]?/gu,
    "select all and copy",
  ],
  [/س[یيئ]?ل[یيئ]?ک[ٹت]?\s+اور\s+کاپ[یيئ]?/gu, "select all and copy"],
  [/س[یيئ]?ل[یيئ]?ک[ٹت]?\s+سب/gu, "select all"],
  [/سب\s+س[یيئ]?ل[یيئ]?ک/gu, "select all"],
  [/کاپ[یيئ]?\s+کرو/gu, "copy"],
  [/یہاں\s+پےسٹ/gu, "paste here"],
  [/پےسٹ\s+کرو/gu, "paste here"],
  [/یہاں\s+چپکاؤ/gu, "paste here"],
  [/چپکاؤ/gu, "paste here"],
  [/سکرول\s+نیچے/gu, "scroll down"],
  [/سکرول\s+اوپر/gu, "scroll up"],
  [/ماؤس\s+نیچے/gu, "move mouse down"],
  [/ماؤس\s+اوپر/gu, "move mouse up"],
  [/ماؤس\s+بائیں/gu, "move mouse left"],
  [/ماؤس\s+دائیں/gu, "move mouse right"],
];

/** Roman Urdu (Latin script) — distinct from Hinglish where patterns differ. */
const ROMAN_PHRASE_MAP: [RegExp, string][] = [
  [/^\s*mera\s+rizume\s+kholo\s*$/i, "open my resume"],
  [/^\s*mera\s+resume\s+kholo\s*$/i, "open my resume"],
  [/^\s*download\s+kholo\s*$/i, "open downloads"],
  [/^\s*downloads\s+kholo\s*$/i, "open downloads"],
  [/^\s*dastavez\s+kholo\s*$/i, "open documents"],
  [/^\s*documents\s+kholo\s*$/i, "open documents"],
  [/^\s*whatsapp\s+kholo\s*$/i, "open whatsapp"],
  [/^\s*kal\s+wali\s+pdf\s+kholo\s*$/i, "open yesterday pdf"],
  [/^\s*kal\s+wali\s+image\s+kholo\s*$/i, "open yesterday image"],
  [/^\s*kal\s+wali\s+photo\s+kholo\s*$/i, "open yesterday image"],
  [/^\s*kal\s+wala\s+video\s+kholo\s*$/i, "open yesterday video"],
  [/^\s*kal\s+wala\s+folder\s+kholo\s*$/i, "open yesterday folder"],
  [
    /^\s*teen\s+mahine\s+pehle\s+wali\s+pdf\s+kholo\s*$/i,
    "open pdf 3 months ago",
  ],
  [/^\s*dobara\s+kholo\s*$/i, "open it again"],
  [/^\s*select\s+all\s+copy\s*$/i, "select all and copy"],
  [/^\s*sab\s+select\s+karo\s+aur\s+copy\s*$/i, "select all and copy"],
  [/^\s*paste\s+karo\s*$/i, "paste here"],
  [/^\s*yahan\s+paste\s*$/i, "paste here"],
  [/^\s*copy\s+karo\s*$/i, "copy"],
];

const ROMAN_WORD_MAP: [RegExp, string][] = [
  [/\bkholiye\b/gi, "open"],
  [/\bkhol\s*den\b/gi, "open"],
  [/\brizume\b/gi, "resume"],
  [/\bdastavez\b/gi, "documents"],
  [/\bmujhe\b/gi, ""],
  [/\bmujhko\b/gi, ""],
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
  [/\bسرچ\b/gu, "search"],
  [/\bتلاش\b/gu, "search"],
  [/\bڈاکٹر\b/gu, "Dr"],
  [/\bفاطمہ\b/gu, "Fatima"],
  [/\bفاطما\b/gu, "Fatima"],
];

export function normalizeUrduEditCommands(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");
  for (const [re, rep] of URDU_EDIT_PHRASE_MAP) {
    s = s.replace(re, rep);
  }
  return s.trim();
}

export function isUrduRoman(text: string): boolean {
  return /\b(?:mujhe|mujhko|kholiye|rizume|dastavez|zaroor|aapka|tumhe)\b/i.test(
    text,
  );
}

export function normalizeUrduRoman(text: string): string {
  if (!text.trim() || containsArabicScript(text)) return text;

  let s = normalizeUrduEditCommands(text);
  s = s.trim().replace(/\s+/g, " ");
  for (const [re, rep] of ROMAN_PHRASE_MAP) {
    s = s.replace(re, rep);
  }
  for (const [re, rep] of ROMAN_WORD_MAP) {
    s = s.replace(re, rep);
  }
  return s.replace(/\s{2,}/g, " ").trim();
}

export function normalizeUrdu(text: string): string {
  const roman = normalizeUrduRoman(text);
  if (!containsArabicScript(roman)) return roman;

  let s = normalizeUrduEditCommands(roman).trim().replace(/\s+/g, " ");
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
