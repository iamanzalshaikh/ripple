import { basename } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Candidate } from "../planner/types.js";
import { resolveAlias } from "../desktop/aliasRegistry.js";
import { searchWindowsShell, searchWindowsIndex } from "../desktop/windowsSearch.js";
import { widenSearchTokens } from "./extractSearchToken.js";
import {
  queryModifiedInRange,
  searchIndexByName,
} from "../../storage/fileIndex.js";
import { searchDiskByNameOnly } from "../desktop/diskSearch.js";
import { getCapabilityCacheHit } from "../../storage/capabilityCache.js";
import { graphLookup } from "./graphLookup.js";
import { semanticRankCandidates } from "./semanticRetriever.js";
import { isSemanticQuery } from "./parseSemanticQuery.js";
import {
  filterCandidatesByTimeRange,
  parseExtensionFromText,
  parseTimeRangeFromText,
  timeRangeToWindow,
  type TimeRangeId,
} from "./timeRange.js";

export type RetrieveInput = {
  phrase: string;
  token?: string;
  extension?: string;
  parentFolder?: string;
  timeRange?: TimeRangeId;
};

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    const key = c.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function toCandidate(
  path: string,
  label: string,
  score: number,
  source: Candidate["source"],
): Candidate | null {
  if (!existsSync(path)) return null;
  return { path, label, score, source, mtime: statSync(path).mtimeMs };
}

/**
 * P5 canonical chain: capability_cache → graph → alias → Windows Search → file_index → disk.
 */
export async function retrieveFileCandidates(
  input: RetrieveInput,
): Promise<Candidate[]> {
  const phrase = input.phrase.trim();
  const explicitToken = input.token?.trim();
  const token = explicitToken ?? (input.timeRange ? "" : phrase.trim());
  if (!token && !input.timeRange) return [];

  const timeRange =
    input.timeRange ?? parseTimeRangeFromText(phrase) ?? undefined;
  const extension =
    input.extension ?? parseExtensionFromText(phrase) ?? undefined;

  const candidates: Candidate[] = [];

  const cacheHit = getCapabilityCacheHit(phrase) ?? getCapabilityCacheHit(token);
  if (cacheHit) {
    const c = toCandidate(cacheHit.entity, phrase, cacheHit.confidence, "cache");
    if (c) candidates.push(c);
  }

  const graph = graphLookup(phrase) ?? graphLookup(token);
  if (graph) candidates.push(graph);

  const alias = resolveAlias(phrase) ?? resolveAlias(token);
  if (alias) {
    const c = toCandidate(alias.path, alias.name, 0.93, "alias");
    if (c) candidates.push(c);
  }

  const indexHits = token ? await searchWindowsIndex(token) : [];
  for (const path of indexHits) {
    const c = toCandidate(path, basename(path), 0.86, "windows_search");
    if (c) candidates.push(c);
  }

  const shellHits = token ? await searchWindowsShell(token) : [];
  for (const path of shellHits) {
    const c = toCandidate(path, basename(path), 0.82, "windows_search");
    if (c) candidates.push(c);
  }

  if (timeRange) {
    const { startMs, endMs } = timeRangeToWindow(timeRange);
    for (const path of queryModifiedInRange(startMs, endMs, {
      token,
      extension,
    })) {
      const c = toCandidate(path, basename(path), 0.88, "index");
      if (c) candidates.push(c);
    }
  } else if (token) {
    for (const path of searchIndexByName(token)) {
      const c = toCandidate(path, basename(path), 0.75, "index");
      if (c) candidates.push(c);
    }
  }

  if (token) {
    for (const path of searchDiskByNameOnly(token)) {
      const c = toCandidate(path, basename(path), 0.6, "local");
      if (c) candidates.push(c);
    }
  }

  let result = dedupeCandidates(candidates);
  if (timeRange) {
    result = filterCandidatesByTimeRange(result, timeRange);
  }
  if (extension) {
    result = result.filter((c) =>
      c.path.toLowerCase().endsWith(`.${extension}`),
    );
  }

  if (isSemanticQuery(phrase)) {
    result = semanticRankCandidates(phrase, result);
  }

  if (result.length === 0 && token) {
    for (const alt of widenSearchTokens(token)) {
      if (alt === token.toLowerCase()) continue;

      const altIndex = await searchWindowsIndex(alt);
      for (const path of altIndex) {
        const c = toCandidate(path, basename(path), 0.78, "windows_search");
        if (c) candidates.push(c);
      }

      for (const path of searchDiskByNameOnly(alt)) {
        const c = toCandidate(path, basename(path), 0.55, "local");
        if (c) candidates.push(c);
      }

      result = dedupeCandidates(candidates);
      if (extension) {
        result = result.filter((c) =>
          c.path.toLowerCase().endsWith(`.${extension}`),
        );
      }
      if (result.length > 0) break;
    }
  }

  return result;
}
