import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  queryLastDownloadedFile,
  getFileIndexCount,
  rebuildFileIndex,
  queryModifiedOnDay,
  queryLatestByExtension,
} from "../../storage/fileIndex.js";
import { smartQueryToRetrieveInput } from "../retriever/retrieveForPlan.js";
import { retrieveFileCandidates } from "../retriever/retriever.js";
import {
  isMediaAliasExtension,
  isOpenedTimeQuery,
} from "../retriever/timeRange.js";
import {
  searchRecentOpenedPathsByExtension,
  searchRecentOpenedPathsByKind,
} from "../../storage/activityLog.js";
import type { OpenedItemKind } from "./openedPathKind.js";
import { getSearchRootKeys, resolveSearchRootPath } from "../../storage/indexConfig.js";
import { pickItemFromMatches } from "./disambiguation.js";
import { openFile, openFolder, resolveFolderPath } from "./openFolder.js";
import type { SmartSearchQuery } from "./parseSmartSearchCommand.js";

function searchRootPaths(): string[] {
  return getSearchRootKeys().map((key) => resolveSearchRootPath(key));
}

const MAX_SCAN_DEPTH = 4;

function ensureIndex(): void {
  if (getFileIndexCount() === 0) {
    rebuildFileIndex();
  }
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function scanPdfsModifiedSince(startMs: number, endMs: number): string[] {
  const hits: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > MAX_SCAN_DEPTH || !existsSync(dir)) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && extname(name).toLowerCase() === ".pdf") {
        if (st.mtimeMs >= startMs && st.mtimeMs < endMs) {
          hits.push(full);
        }
      } else if (st.isDirectory() && depth < MAX_SCAN_DEPTH) {
        walk(full, depth + 1);
      }
    }
  }

  for (const rootPath of searchRootPaths()) {
    walk(rootPath, 0);
  }

  return hits.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

async function collectTodayPdfMatches(): Promise<string[]> {
  ensureIndex();
  const { startMs, endMs } = timeRangeToWindow("today");

  const fromIndex = queryModifiedOnDay(startMs, endMs, "pdf");
  const fromDisk = scanPdfsModifiedSince(startMs, endMs);

  return dedupePaths([...fromIndex, ...fromDisk]).filter((p) => existsSync(p));
}

async function collectMatchesAsync(
  query: SmartSearchQuery,
  label: string,
): Promise<string[]> {
  if (query.type === "last_downloaded") {
    ensureIndex();
    return queryLastDownloadedFile();
  }

  if (query.type === "modified_today" && query.extension === "pdf") {
    if (label === "tomorrow_pdf") {
      console.info(
        "[ripple-desktop] Smart search tomorrow_pdf — treating as today's PDF (common Whisper mishear)",
      );
    }
    const todayPdfs = await collectTodayPdfMatches();
    if (todayPdfs.length > 0) return todayPdfs;
  }

  const input = smartQueryToRetrieveInput(query, label);
  const candidates = await retrieveFileCandidates(input);

  return candidates.map((c) => c.path);
}

async function fallbackTodayPdf(): Promise<string[]> {
  const last = queryLastDownloadedFile().filter(
    (p) => existsSync(p) && p.toLowerCase().endsWith(".pdf"),
  );
  if (last.length > 0) {
    console.info(
      "[ripple-desktop] Smart search today_pdf — using last downloaded PDF",
    );
    return last;
  }

  const newest = queryLatestByExtension("pdf", 10).filter((p) => existsSync(p));
  if (newest.length > 0) {
    console.info(
      "[ripple-desktop] Smart search today_pdf — using newest PDF by date",
    );
  }
  return newest;
}

function pickBestMatch(label: string, matches: string[]): string | null {
  if (matches.length <= 1) return matches[0] ?? null;

  const scored = matches.map((p) => {
    const name = basename(p).toLowerCase();
    const mtime = statSync(p).mtimeMs;
    let score = mtime;
    if (label.toLowerCase().includes("resume") && name.includes("resume")) {
      score += 1_000_000_000_000;
    }
    if (label.toLowerCase().includes("invoice") && name.includes("invoice")) {
      score += 1_000_000_000_000;
    }
    return { p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  const second = scored[1]!;

  if (top.score - second.score > top.score * 0.15) {
    console.info(
      `[ripple-desktop] Smart search auto-pick "${label}" → ${top.p}`,
    );
    return top.p;
  }

  return null;
}

/**
 * Resolve a smart search query to one file path (P5 retriever + disambiguation).
 */
export async function resolveSmartSearch(
  query: SmartSearchQuery,
  label: string,
): Promise<string> {
  let resolved = (await collectMatchesAsync(query, label)).filter((p) =>
    existsSync(p),
  );

  if (
    resolved.length === 0 &&
    query.type === "modified_today" &&
    (query.extension === "pdf" || !query.extension)
  ) {
    resolved = await fallbackTodayPdf();
  }

  if (resolved.length === 0) {
    if (query.type === "time_ranged") {
      const input = smartQueryToRetrieveInput(query, label);
      if (isOpenedTimeQuery(input.phrase) && input.extension) {
        const recent = (
          isMediaAliasExtension(input.extension)
            ? searchRecentOpenedPathsByKind(
                input.extension as OpenedItemKind,
                15,
              )
            : searchRecentOpenedPathsByExtension(input.extension, 15)
        ).filter((p) => existsSync(p));
        if (recent.length > 0) {
          const rangeLabel =
            input.timeRange ?? "that time";
          console.info(
            `[ripple-desktop] temporal ${rangeLabel} ${input.extension} — no exact hits, clarify with ${recent.length} recent`,
          );
          const picked = await pickItemFromMatches(
            `No ${input.extension} from ${rangeLabel} — pick one you opened recently`,
            recent,
          );
          if (picked) {
            console.info(
              `[ripple-desktop] Smart search "${label}" → ${picked} (recent pick)`,
            );
            return picked;
          }
          throw new Error("Cancelled — pick which file you meant");
        }
      }
    }

    throw new Error(
      `No file found for "${label}" — try a specific name or say which folder it's in`,
    );
  }

  if (resolved.length === 1) {
    console.info(`[ripple-desktop] Smart search "${label}" → ${resolved[0]}`);
    return resolved[0]!;
  }

  if (query.type === "last_downloaded") {
    const newest = resolved[0]!;
    console.info(
      `[ripple-desktop] Smart search last_downloaded auto-pick → ${newest}`,
    );
    return newest;
  }

  const timeBased =
    query.type === "modified_today" ||
    query.type === "modified_yesterday" ||
    query.type === "modified_last_week" ||
    query.type === "modified_3_months_ago" ||
    query.type === "edited_yesterday" ||
    query.type === "time_ranged";
  if (timeBased) {
    const sorted = [...resolved].sort(
      (a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs,
    );
    const newest = sorted[0]!;
    console.info(`[ripple-desktop] Smart search "${label}" auto-pick → ${newest}`);
    return newest;
  }

  const resumeMatches = resolved.filter((p) =>
    basename(p).toLowerCase().includes("resume"),
  );
  if (
    label.toLowerCase().includes("resume") &&
    resumeMatches.length === 1
  ) {
    console.info(
      `[ripple-desktop] Smart search resume auto-pick → ${resumeMatches[0]}`,
    );
    return resumeMatches[0]!;
  }

  const auto = pickBestMatch(label, resolved);
  if (auto) return auto;

  const picked = await pickItemFromMatches(label, resolved);
  if (!picked) {
    throw new Error("Cancelled — pick which file you meant");
  }

  console.info(`[ripple-desktop] Smart search "${label}" → ${picked} (user picked)`);
  return picked;
}

export async function openSmartSearchResult(path: string): Promise<string> {
  const st = statSync(path);
  if (st.isDirectory()) {
    return openFolder(path);
  }
  return openFile(path);
}
