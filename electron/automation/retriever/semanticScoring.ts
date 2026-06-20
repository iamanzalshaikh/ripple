const STOPWORDS = new Set([
  "a", "an", "the", "my", "me", "i", "we", "you", "it", "that", "this", "thing",
  "open", "show", "find", "file", "folder", "pdf", "doc", "document", "with",
  "from", "about", "before", "after", "discussed", "meeting", "sent", "karo",
  "kholo", "dikhao", "wali", "wala",
]);

export function tokenizeForSemantic(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\u0600-\u06FF\s_-]/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function semanticOverlapScore(
  phrase: string,
  profileTokens: string[],
  profileSnippet: string,
): number {
  const query = tokenizeForSemantic(phrase);
  if (query.length === 0) return 0;

  const docTokens = new Set(profileTokens);
  const phraseLower = phrase.toLowerCase();
  const snippetLower = profileSnippet.toLowerCase();

  let hits = 0;
  for (const q of query) {
    if (docTokens.has(q)) hits++;
    else if (snippetLower.includes(q)) hits += 0.5;
  }

  const phraseBonus =
    phraseLower.split(/\s+/).filter((w) => snippetLower.includes(w)).length *
    0.05;

  return Math.min(0.99, hits / query.length + phraseBonus);
}

export function recencyBoost(mtimeMs: number, now = Date.now()): number {
  const ageDays = Math.max(0, (now - mtimeMs) / (24 * 60 * 60 * 1000));
  return Math.exp(-ageDays / 45) * 0.15;
}
