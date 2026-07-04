import { isLastOpenedRecallQuery } from "./timeRange.js";

/** P8 — detect vague semantic references (people, events, topics). */
export function isSemanticQuery(phrase: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (!p) return false;
  if (isLastOpenedRecallQuery(p)) return false;
  if (/\b(?:open\s+)?gmail\s+thread\b/i.test(p)) return false;
  if (/\bgmail\b.*\b(?:attachment|attached)\b/i.test(p)) return false;
  if (/\bopen\s+email\s+from\b/i.test(p)) return false;
  if (/\bopen\s+(?:the\s+)?\w+\s+email\b/i.test(p)) return false;

  const patterns = [
    /\bdiscussed\s+with\b/,
    /\bmeeting\s+with\b/,
    /\b(talked|spoken)\s+(with|to)\b/,
    /\bthat\s+thing\b/,
    /\bthe\s+thing\b/,
    /\bbefore\s+my\b/,
    /\bgoa\s+trip\b/,
    /\bsent\s+(by|from)\b/,
    /\bfrom\s+[a-z]+\b/,
    /\bwith\s+[a-z]+\b/,
    /\bpdf\s+i\b/,
    /\bdocument\s+(about|for|from)\b/,
    /\bproject\s+i\b/,
    /\bfile\s+i\b/,
    /\bresume\s+i\b/,
    /\battachment\b/,
    /\bwhatsapp\b.*\b(sent|shared)\b/,
    /\b(sent|shared)\b.*\b(on\s+)?whatsapp\b/,
    /\bmera\s+.+\s+(jo|wali)\b/,
    /\bjo\s+maine\b/,
    /\bbefore\s+my\b/,
  ];

  return patterns.some((re) => re.test(p));
}

export function extractSemanticTopic(phrase: string): string {
  const p = phrase.trim();
  const withPerson = p.match(/\b(?:with|from|to|by)\s+([A-Za-z][A-Za-z0-9_-]{1,24})\b/i);
  if (withPerson?.[1]) return withPerson[1];

  const about = p.match(/\b(?:about|regarding|for)\s+(.+?)\s*$/i);
  if (about?.[1]) return about[1].trim();

  return p;
}
