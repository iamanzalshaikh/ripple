/**
 * Post-Whisper correction layer (Translation / vocabulary fix).
 * Runs after UTF repair, before NLU — fixes common Whisper mishearings.
 */

const WORD_FIXES: [RegExp, string][] = [
  [/\bworkmode\b/gi, "work mode"],
  [/\bgithub\s+desktop\b/gi, "github"],
  [/\bgit\s+hub\b/gi, "github"],
];

export function correctWhisperMishearings(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");
  if (!s) return s;

  // Order matters — longest / most specific first
  s = s.replace(
    /^member\s+work\s+mode\s*,?\s*open\s*,?\s*/i,
    "Remember work mode open ",
  );
  s = s.replace(/^member\s+work\s+mode\b/i, "Remember work mode");
  s = s.replace(/^member\s+/i, "Remember ");
  s = s.replace(/^remember\s+workmode\b/i, "Remember work mode");
  s = s.replace(
    /^remember\s+work\s+mode\s*,?\s*open\s*,?\s*/i,
    "Remember work mode open ",
  );
  s = s.replace(/^remember\s+(.+?)\s*,\s*open\s*,\s*/i, "Remember $1 open ");

  // Whisper often hears "today's pdf" as "tomorrow's pdf"
  s = s.replace(/\btomorrow'?s?\s+pdf\b/gi, "today's pdf");

  for (const [re, rep] of WORD_FIXES) {
    s = s.replace(re, rep);
  }

  return s.trim();
}
