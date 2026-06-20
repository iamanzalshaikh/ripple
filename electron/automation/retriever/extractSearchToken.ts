/** Pull a file/item token from varied open/search phrasing (EN + Hinglish). */
export function extractSearchToken(phrase: string): string | null {
  const text = phrase.trim();
  if (!text) return null;

  const patterns = [
    /^\s*open\s+(?:my\s+|the\s+|mera\s+)?(.+?)\s*$/i,
    /^\s*(?:mera|my)\s+(.+?)\s+(?:kholo|khol|open)\s*$/i,
    /^\s*(.+?)\s+(?:kholo|khol)\s*$/i,
    /^\s*(?:kholo|khol|dikhao|find|show)\s+(?:mera\s+|my\s+|the\s+)?(.+?)\s*$/i,
    /^\s*(?:search|find)\s+(?:for\s+)?(?:my\s+|the\s+)?(.+?)\s*$/i,
    /^\s*(?:pdf|file|folder)\s+(?:i\s+)?(?:discussed|talked|worked)\s+(?:with|about)\s+(.+?)\s*$/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]?.trim()) {
      return m[1].trim().replace(/\s+(?:pdf|file|folder)$/i, "").trim();
    }
  }

  return null;
}

/** Fallback tokens when primary search returns zero hits. */
export function widenSearchTokens(primary: string): string[] {
  const base = primary.trim().toLowerCase();
  if (!base) return [];

  const out = new Set<string>();
  const stop = new Set([
    "the",
    "my",
    "mera",
    "open",
    "kholo",
    "file",
    "folder",
    "pdf",
    "please",
    "yaar",
    "bhai",
  ]);

  for (const word of base.split(/\s+/)) {
    const w = word.replace(/[^a-z0-9._-]/gi, "");
    if (w.length >= 3 && !stop.has(w)) out.add(w);
  }

  if (base.length >= 3) out.add(base);
  return [...out];
}
