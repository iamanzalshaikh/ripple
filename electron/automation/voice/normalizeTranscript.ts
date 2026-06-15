/**
 * Post-Whisper cleanup — not a replacement for STT.
 */
export function normalizeTranscript(text: string): string {
  let s = text.trim().replace(/\s+/g, " ");

  // Whisper pause commas (not list separators): "Remember, work mode, open X"
  s = s.replace(/^(remember|forget|remove|start|run|launch|list|show)\s*,\s*/i, "$1 ");
  s = s.replace(/^(forget|remove)\s+workflow\s*,\s*/i, "$1 workflow ");
  s = s.replace(/,\s*open\s+/gi, " open ");
  s = s.replace(/\bremember\s+(?:my\s+)?([^,]+?)\s*,\s*open\b/gi, "remember $1 open");

  // Whisper singular: "Open setting" → "Open settings"
  s = s.replace(/\bopen\s+(?:windows\s+)?setting\b/gi, "open settings");
  s = s.replace(/\bopen\s+(?:the\s+)?system\s+setting\b/gi, "open system settings");
  s = s.replace(/\bopen\s+(?:the\s+)?bluetooth\s+setting\b/gi, "open bluetooth settings");
  s = s.replace(
    /\bopen\s+(?:the\s+)?network\s+setting\b/gi,
    "open network settings",
  );
  s = s.replace(/\bopen\s+(?:the\s+)?wifi\s+setting\b/gi, "open wifi settings");
  s = s.replace(/\bopen\s+(?:the\s+)?wi-?fi\s+setting\b/gi, "open wifi settings");

  // Whisper pause commas: "Move, flow to, downloads"
  s = s.replace(/^(move|rename|delete)\s*,\s*/i, "$1 ");
  s = s.replace(/\bto\s*,\s*/gi, "to ");
  s = s.replace(/,\s+to\s+/gi, " to ");

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

  // Whisper glues "Open" + filename: "OpenResume.pdf" -> "Open Resume.pdf"
  s = s.replace(/\bopen([A-Za-z0-9][^\s]*\.\w{2,8})\b/gi, "open $1");

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
