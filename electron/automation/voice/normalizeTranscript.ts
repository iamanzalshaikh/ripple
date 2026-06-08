/**
 * Post-Whisper cleanup — not a replacement for STT.
 */
export function normalizeTranscript(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");

  s = s.replace(/\s+and\s+text\s+/gi, " and say ");
  s = s.replace(/\bsaaliq\b/gi, "Saaliq");
  s = s.replace(/\bwhats\s*app\b/gi, "WhatsApp");
  // Common Whisper mishearings for contact names
  s = s.replace(/\bsearch\s+me\s+one\b/gi, "search Ammi1");
  s = s.replace(/\bsearch\s+ami\s+one\b/gi, "search Ammi1");
  s = s.replace(/\bsearch\s+ammi\s+1\b/gi, "search Ammi1");
  s = s.replace(/\bsearch\s+a\s+me\s+1\b/gi, "search Ammi1");
  s = s.replace(/\babhishek\s+vark\b/gi, "Abhishek");
  s = s.replace(/\babhishek\s+dwork\b/gi, "Abhishek");
  s = s.replace(/\bgoodnight\b/gi, "good night");

  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Trailing punctuation breaks phrase parsers (e.g. "... on YouTube.")
  s = s.replace(/[.,!?;:]+$/g, "").trim();
  // "saying, how are you" → "saying how are you" (voice comma after saying)
  s = s.replace(/\b(saying|ask)\s*,\s*/gi, "$1 ");

  return s;
}

export function normalizeContactToken(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
