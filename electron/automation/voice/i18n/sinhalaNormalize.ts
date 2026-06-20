/**
 * Phase 4.7 — Sinhala script → English slots (basic desktop verbs).
 */

import { containsSinhala } from "./scriptDetect.js";

const PHRASE_MAP: [RegExp, string][] = [
  [/බ්‍රවුසර්\s*(?:ඕපන්|විවෘත)\s*කරන්න/gi, "open browser"],
  [/බ්‍රවුසර්\s*ඕපන්/gi, "open browser"],
  [/ඩවුන්ලෝඩ්\s*(?:ඕපන්|විවෘත)\s*කරන්න/gi, "open downloads"],
  [/ඩවුන්ලෝඩ්\s*ඕපන්/gi, "open downloads"],
  [/මගේ\s*රෙසියුම්\s*(?:ඕපන්|විවෘත)\s*කරන්න/gi, "open my resume"],
  [/වොට්ස්ඇප්\s*(?:ඕපන්|විවෘත)\s*කරන්න/gi, "open whatsapp"],
];

const WORD_MAP: [RegExp, string][] = [
  [/විවෘත\s*කරන්න/gu, "open"],
  [/ඕපන්/gu, "open"],
  [/බ්‍රවුසර්/gu, "browser"],
  [/ඩවුන්ලෝඩ්/gu, "downloads"],
  [/ලේඛන/gu, "documents"],
  [/ඩෙස්ක්ටොප්/gu, "desktop"],
  [/ගොනුව/gu, "file"],
  [/ෆෝල්ඩරය/gu, "folder"],
  [/රෙසියුම්/gu, "resume"],
  [/වොට්ස්ඇප්/gu, "whatsapp"],
  [/සෙවුම්/gu, "search"],
  [/අනිත්/gu, "and"],
  [/මගේ/gu, "my"],
];

export function normalizeSinhala(text: string): string {
  if (!containsSinhala(text)) return text;

  let s = text.trim().replace(/\s+/g, " ");
  for (const [re, rep] of PHRASE_MAP) s = s.replace(re, rep);
  for (const [re, rep] of WORD_MAP) s = s.replace(re, rep);

  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s.trim();
}
