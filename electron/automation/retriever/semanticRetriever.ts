import { basename } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Candidate } from "../planner/types.js";
import { searchActivityByPhrase } from "../../storage/activityLog.js";
import {
  getSemanticProfile,
  searchSemanticIndex,
} from "../../storage/semanticIndex.js";
import {
  searchPathEmbeddings,
  searchSemanticRefs,
} from "../../storage/semanticEmbeddings.js";
import {
  recencyBoost,
  semanticOverlapScore,
  tokenizeForSemantic,
} from "./semanticScoring.js";
import { isJunkRecallPath } from "./pathRecallFilters.js";
import { rankSemanticProfile } from "./semanticVectorRank.js";
import {
  extractSemanticTopic,
  isSemanticQuery,
} from "./parseSemanticQuery.js";

function isJunkSemanticPath(path: string): boolean {
  return isJunkRecallPath(path);
}

function toSemanticCandidate(
  path: string,
  score: number,
  label?: string,
): Candidate | null {
  if (isJunkSemanticPath(path)) return null;
  if (!existsSync(path)) return null;
  return {
    path,
    label: label ?? basename(path),
    score,
    source: "semantic",
    mtime: statSync(path).mtimeMs,
  };
}

/** P8 second pass — rerank P5 candidates + inject activity/semantic hits. */
export function semanticRankCandidates(
  phrase: string,
  candidates: Candidate[],
): Candidate[] {
  const topic = extractSemanticTopic(phrase);
  const useSemantic = isSemanticQuery(phrase);
  if (!useSemantic) return candidates;

  const merged = new Map<string, Candidate>();

  for (const c of candidates) {
    merged.set(c.path.toLowerCase(), { ...c });
  }

  for (const path of searchActivityByPhrase(topic)) {
    const existing = merged.get(path.toLowerCase());
    if (existing) {
      existing.score = Math.min(0.98, existing.score + 0.2);
      existing.source = "semantic";
    } else {
      const hit = toSemanticCandidate(path, 0.78);
      if (hit) merged.set(path.toLowerCase(), hit);
    }
  }

  for (const ref of searchSemanticRefs(phrase, 8)) {
    const refPhrase = [ref.summary, ref.contact ?? "", ref.appId ?? ""]
      .filter(Boolean)
      .join(" ");
    for (const path of searchActivityByPhrase(refPhrase, 6)) {
      const existing = merged.get(path.toLowerCase());
      if (existing) {
        existing.score = Math.min(0.99, existing.score + 0.25);
        existing.source = "semantic";
      } else {
        const hit = toSemanticCandidate(path, 0.76 + (ref.score ?? 0) * 0.1);
        if (hit) merged.set(path.toLowerCase(), hit);
      }
    }
  }

  for (const emb of searchPathEmbeddings(phrase, 12)) {
    if (isJunkSemanticPath(emb.path)) continue;
    const existing = merged.get(emb.path.toLowerCase());
    if (existing) {
      existing.score = Math.min(0.99, existing.score * 0.5 + emb.score * 0.5);
      existing.source = "semantic";
    } else {
      const hit = toSemanticCandidate(emb.path, Math.min(0.92, emb.score));
      if (hit) merged.set(emb.path.toLowerCase(), hit);
    }
  }

  for (const profile of searchSemanticIndex(phrase, 10)) {
    const existing = merged.get(profile.path.toLowerCase());
    const semScore = rankSemanticProfile(phrase, profile);
    const recency = recencyBoost(profile.mtime);
    const combined = Math.min(0.97, semScore * 0.85 + recency);

    if (existing) {
      existing.score = Math.min(0.99, existing.score * 0.55 + combined * 0.45);
      if (semScore > 0.35) existing.source = "semantic";
    } else if (combined >= 0.25) {
      const hit = toSemanticCandidate(profile.path, combined, profile.label);
      if (hit) merged.set(profile.path.toLowerCase(), hit);
    }
  }

  for (const [key, c] of merged) {
    const profile = getSemanticProfile(c.path);
    const tokens = profile?.tokens ?? tokenizeForSemantic(c.label);
    const snippet = profile?.snippet ?? c.label;
    const boost = semanticOverlapScore(phrase, tokens, snippet);
    if (boost > 0) {
      c.score = Math.min(0.99, c.score * 0.7 + boost * 0.3 + recencyBoost(c.mtime ?? Date.now()));
      if (boost > 0.4) c.source = "semantic";
    }
    merged.set(key, c);
  }

  const result = [...merged.values()].sort((a, b) => b.score - a.score);

  if (isSemanticQuery(phrase) && result.length > 0) {
    console.info(
      `[ripple-desktop] P8 semantic → ${result.length} hit(s) for "${phrase.slice(0, 60)}" (top: ${result[0]?.path})`,
    );
  }

  return result;
}
