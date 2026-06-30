import { basename } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Candidate } from "../planner/types.js";
import { resolveAlias } from "../desktop/aliasRegistry.js";
import {
  searchWindowsByExtension,
  searchWindowsIndex,
  searchWindowsShell,
} from "../desktop/windowsSearch.js";
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
  isMediaAliasExtension,
  isOpenedTimeQuery,
  parseExtensionFromText,
  parseParentFolderFromText,
  parseTimeRangeFromText,
  stripRetrieverBoilerplate,
  stripTimePhrasesFromToken,
  timeRangeToWindow,
  type TimeRangeId,
} from "./timeRange.js";
import {
  searchActivityPathsInRange,
  searchActivityPathsInRangeByKind,
  searchActivityByPhrase,
  searchRecentOpenedPathsByExtension,
} from "../../storage/activityLog.js";
import { searchSemanticIndex } from "../../storage/semanticIndex.js";
import {
  findLifeEventByTopicPhrase,
  windowBeforeLifeEvent,
} from "../../storage/lifeEvents.js";
import {
  searchDesktopHistoryPathsInRange,
  searchDesktopHistoryPathsInRangeByKind,
} from "../../storage/desktopHistory.js";
import { pathMatchesOpenedKind } from "../desktop/openedPathKind.js";
import type { OpenedItemKind } from "../desktop/openedPathKind.js";
import { queryLatestByExtension } from "../../storage/fileIndex.js";
import { cacheRetrieverHits } from "./cacheRetrieverHits.js";
import { filterCandidatesByParentFolder } from "./parentFolderFilter.js";
import { recordRetrieverOutcome } from "./retrieverTelemetry.js";

export type RetrieveInput = {
  phrase: string;
  token?: string;
  extension?: string;
  parentFolder?: string;
  timeRange?: TimeRangeId;
  lifeEventTopic?: string;
  contactTopic?: string;
};

const DISK_SKIP_MIN_WINDOWS_HITS = 5;

function activityPathsForTemporal(
  startMs: number,
  endMs: number,
  extension?: string,
): string[] {
  if (extension === "image" || extension === "video") {
    return searchActivityPathsInRangeByKind(startMs, endMs, extension);
  }
  return searchActivityPathsInRange(startMs, endMs, { extension });
}

function historyPathsForTemporal(
  startMs: number,
  endMs: number,
  extension?: string,
): string[] {
  if (extension === "image" || extension === "video") {
    return searchDesktopHistoryPathsInRangeByKind(startMs, endMs, extension);
  }
  return searchDesktopHistoryPathsInRange(startMs, endMs, { extension });
}

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

function addWindowsHits(
  candidates: Candidate[],
  paths: string[],
  score: number,
): void {
  for (const path of paths) {
    const c = toCandidate(path, basename(path), score, "windows_search");
    if (c) candidates.push(c);
  }
}

function normalizeRetrieveToken(
  phrase: string,
  explicitToken: string | undefined,
  timeRange: TimeRangeId | undefined,
  extension?: string,
): string {
  let raw = explicitToken?.trim() ?? "";
  if (!raw) {
    if (timeRange || extension) {
      raw = stripRetrieverBoilerplate(phrase);
    } else {
      raw = phrase.trim();
    }
  }
  if (!raw) return "";
  if (timeRange || extension) {
    const stripped = stripTimePhrasesFromToken(raw);
    return stripped.length >= 2 ? stripped : "";
  }
  return raw;
}

/**
 * P5 canonical chain: capability_cache → graph → alias → Windows Search → file_index → disk.
 */
export async function retrieveFileCandidates(
  input: RetrieveInput,
): Promise<Candidate[]> {
  const phrase = input.phrase.trim();
  const timeRange =
    input.timeRange ?? parseTimeRangeFromText(phrase) ?? undefined;
  const extension =
    input.extension ?? parseExtensionFromText(phrase) ?? undefined;
  const parentFolder =
    input.parentFolder ?? parseParentFolderFromText(phrase) ?? undefined;
  const token = normalizeRetrieveToken(phrase, input.token, timeRange, extension);

  const semanticQuery = isSemanticQuery(phrase);
  if (!token && !timeRange && !extension && !semanticQuery) return [];

  const candidates: Candidate[] = [];
  const winOpts = extension ? { extension } : undefined;

  if (semanticQuery) {
    const activityPhrase = input.contactTopic
      ? `${phrase} ${input.contactTopic}`
      : phrase;
    for (const path of searchActivityByPhrase(activityPhrase, 18)) {
      const c = toCandidate(path, basename(path), 0.87, "semantic");
      if (c) candidates.push(c);
    }
    for (const profile of searchSemanticIndex(phrase, 18)) {
      const c = toCandidate(profile.path, profile.label, 0.84, "semantic");
      if (c) candidates.push(c);
    }
  }

  const cacheHit =
    getCapabilityCacheHit(phrase) ??
    (token ? getCapabilityCacheHit(token) : undefined);
  if (cacheHit) {
    const c = toCandidate(cacheHit.entity, phrase, cacheHit.confidence, "cache");
    if (c) candidates.push(c);
  }

  const graph = graphLookup(phrase) ?? (token ? graphLookup(token) : null);
  if (graph) candidates.push(graph);

  const alias =
    resolveAlias(phrase) ?? (token ? resolveAlias(token) : null);
  if (alias) {
    const c = toCandidate(alias.path, alias.name, 0.93, "alias");
    if (c) candidates.push(c);
  }

  if (token) {
    const indexHits = await searchWindowsIndex(token, winOpts ?? {});
    addWindowsHits(candidates, indexHits, 0.86);

    const shellHits = await searchWindowsShell(token, winOpts ?? {});
    addWindowsHits(candidates, shellHits, 0.82);
  } else if (extension) {
    const extHits = await searchWindowsByExtension(extension);
    addWindowsHits(candidates, extHits, 0.84);
  }

  if (timeRange) {
    const { startMs, endMs } = timeRangeToWindow(timeRange);
    const openedQuery = isOpenedTimeQuery(phrase);

    if (openedQuery) {
      for (const path of activityPathsForTemporal(startMs, endMs, extension)) {
        const c = toCandidate(path, basename(path), 0.94, "semantic");
        if (c) candidates.push(c);
      }
      for (const path of historyPathsForTemporal(startMs, endMs, extension)) {
        const c = toCandidate(path, basename(path), 0.91, "semantic");
        if (c) candidates.push(c);
      }
    } else {
      for (const path of queryModifiedInRange(startMs, endMs, {
        token: token || undefined,
        extension,
      })) {
        const c = toCandidate(path, basename(path), 0.88, "index");
        if (c) candidates.push(c);
      }
    }
  } else if (token) {
    for (const path of searchIndexByName(token)) {
      const c = toCandidate(path, basename(path), 0.75, "index");
      if (c) candidates.push(c);
    }
  }

  const windowsHitCount = candidates.filter(
    (c) => c.source === "windows_search",
  ).length;

  if (token && windowsHitCount < DISK_SKIP_MIN_WINDOWS_HITS) {
    for (const path of searchDiskByNameOnly(token)) {
      const c = toCandidate(path, basename(path), 0.6, "local");
      if (c) candidates.push(c);
    }
  }

  let result = dedupeCandidates(candidates);
  if (timeRange) {
    const openedQuery = isOpenedTimeQuery(phrase);
    if (openedQuery) {
      const activityHits = result.filter((c) => c.source === "semantic");
      const rest = filterCandidatesByTimeRange(
        result.filter((c) => c.source !== "semantic"),
        timeRange,
      );
      result = dedupeCandidates([...activityHits, ...rest]);
    } else {
      result = filterCandidatesByTimeRange(result, timeRange);
    }
  }
  if (extension) {
    result = result.filter((c) => {
      if (isMediaAliasExtension(extension)) {
        return pathMatchesOpenedKind(c.path, extension);
      }
      return c.path.toLowerCase().endsWith(`.${extension}`);
    });
  }

  if (isSemanticQuery(phrase) && !timeRange) {
    result = semanticRankCandidates(phrase, result);
  }

  if (input.lifeEventTopic) {
    const event =
      findLifeEventByTopicPhrase(input.lifeEventTopic) ??
      findLifeEventByTopicPhrase(phrase);
    if (event) {
      const { startMs, endMs } = windowBeforeLifeEvent(event);
      const inWindow = new Set<string>();
      for (const path of searchActivityPathsInRange(startMs, endMs, {
        extension,
      })) {
        inWindow.add(path.toLowerCase());
      }
      const lifeFiltered = result.filter(
        (c) => (c.mtime ?? 0) < endMs || inWindow.has(c.path.toLowerCase()),
      );
      if (lifeFiltered.length > 0) {
        result = lifeFiltered;
        console.info(
          `[ripple-desktop] P8 life-event filter → before "${event.label}" (${lifeFiltered.length} hit(s))`,
        );
      }
    }
  }

  result = filterCandidatesByParentFolder(result, parentFolder);

  if (result.length === 0 && extension && timeRange) {
    if (isOpenedTimeQuery(phrase)) {
      const { startMs, endMs } = timeRangeToWindow(timeRange);
      for (const path of activityPathsForTemporal(startMs, endMs, extension)) {
        const c = toCandidate(path, basename(path), 0.9, "semantic");
        if (c) candidates.push(c);
      }
      for (const path of historyPathsForTemporal(startMs, endMs, extension)) {
        const c = toCandidate(path, basename(path), 0.88, "semantic");
        if (c) candidates.push(c);
      }
      result = dedupeCandidates(candidates);
      result = filterCandidatesByParentFolder(result, parentFolder);
      if (result.length > 0) {
        console.info(
          `[ripple-desktop] temporal opened search → ${result.length} hit(s) from activity/history`,
        );
      }
    } else if (!isMediaAliasExtension(extension)) {
      for (const path of queryLatestByExtension(extension, 12)) {
        const c = toCandidate(path, basename(path), 0.72, "index");
        if (c) candidates.push(c);
      }
      result = dedupeCandidates(candidates);
      result = filterCandidatesByTimeRange(result, timeRange);
      result = filterCandidatesByParentFolder(result, parentFolder);
    }
  }

  if (result.length === 0 && token) {
    for (const alt of widenSearchTokens(token)) {
      if (alt === token.toLowerCase()) continue;

      const altIndex = await searchWindowsIndex(alt, winOpts ?? {});
      addWindowsHits(candidates, altIndex, 0.78);

      if (windowsHitCount < DISK_SKIP_MIN_WINDOWS_HITS) {
        for (const path of searchDiskByNameOnly(alt)) {
          const c = toCandidate(path, basename(path), 0.55, "local");
          if (c) candidates.push(c);
        }
      }

      result = dedupeCandidates(candidates);
      if (timeRange) {
        result = filterCandidatesByTimeRange(result, timeRange);
      }
      if (extension) {
        result = result.filter((c) =>
          c.path.toLowerCase().endsWith(`.${extension}`),
        );
      }
      result = filterCandidatesByParentFolder(result, parentFolder);
      if (result.length > 0) break;
    }
  }

  cacheRetrieverHits(result, phrase);
  recordRetrieverOutcome(phrase, result);
  return result;
}
