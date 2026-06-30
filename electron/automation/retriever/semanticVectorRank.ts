import type { SemanticProfile } from "../../storage/semanticIndex.js";
import {
  recencyBoost,
  semanticOverlapScore,
  tokenizeForSemantic,
} from "./semanticScoring.js";

/** BM25-lite lexical score — sqlite-vec fallback without native extension. */
export function bm25LiteScore(phrase: string, document: string): number {
  const queryTokens = tokenizeForSemantic(phrase);
  if (queryTokens.length === 0) return 0;

  const docLower = document.toLowerCase();
  const docLen = Math.max(1, tokenizeForSemantic(document).length);
  const k1 = 1.2;
  const b = 0.75;
  const avgLen = 40;

  let score = 0;
  for (const term of queryTokens) {
    const tf = (docLower.match(new RegExp(`\\b${escapeRe(term)}\\b`, "g")) ?? [])
      .length;
    if (tf === 0) continue;
    const idf = 1.5;
    const num = tf * (k1 + 1);
    const den = tf + k1 * (1 - b + (b * docLen) / avgLen);
    score += idf * (num / den);
  }

  return Math.min(1, score / (queryTokens.length * 2.5));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Combined P8b rank — overlap + BM25 + recency. */
export function rankSemanticProfile(
  phrase: string,
  profile: SemanticProfile,
): number {
  const overlap = semanticOverlapScore(
    phrase,
    profile.tokens,
    profile.snippet,
  );
  const bm25 = bm25LiteScore(phrase, profile.snippet);
  const recency = recencyBoost(profile.mtime);
  return Math.min(0.99, overlap * 0.5 + bm25 * 0.35 + recency);
}

export function rankSemanticProfiles(
  phrase: string,
  profiles: SemanticProfile[],
  limit = 20,
): SemanticProfile[] {
  return profiles
    .map((profile) => ({ profile, score: rankSemanticProfile(phrase, profile) }))
    .filter((x) => x.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.profile);
}
