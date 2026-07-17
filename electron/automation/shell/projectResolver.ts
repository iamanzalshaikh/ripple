import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import {
  findNativeAppById,
  type NativeAppEntry,
} from "../desktop/nativeAppRegistry.js";
import { resolveLaunchTarget } from "../desktop/resolveLaunchTarget.js";
import {
  focusAppWindow,
  focusAppWindowPreferringTitle,
  isAppWindowShowingTitle,
} from "../desktop/windowManager.js";
import { delay } from "../delay.js";
import { searchIndexedDirectories } from "../../storage/fileIndex.js";
import { searchItemsByNameAsync } from "../desktop/searchFiles.js";
import { getUserPreferences } from "../../storage/userPreferences.js";
import { applyCorrectionsToUtterance } from "../../storage/voiceCorrections.js";
import {
  folderLabelFromPath,
  normalizeFolderLabel,
  normalizeWindowsPath,
  scoreFolderNameMatch,
  tokenizeFolderHint,
} from "./projectPathNormalize.js";

const IDE_CANDIDATE_IDS = ["vscode", "cursor", "antigravity-ide"] as const;

function preferredIdeIds(): string[] {
  try {
    const raw = getUserPreferences().preferredIde?.trim().toLowerCase() ?? "";
    if (!raw) return [];
    if (raw.includes("cursor")) return ["cursor"];
    if (raw.includes("antigravity")) return ["antigravity-ide"];
    if (
      raw.includes("vscode") ||
      raw === "code" ||
      raw.includes("vs code") ||
      raw.includes("visual studio code")
    ) {
      return ["vscode"];
    }
  } catch {
    /* prefs optional at boot */
  }
  return [];
}

function tryResolveIdeById(id: string): NativeAppEntry | null {
  const app = findNativeAppById(id);
  if (!app) return null;
  const target = resolveLaunchTarget(app);
  if (!isLaunchTargetUsable(target)) return null;

  if (app.id === "vscode" && /cursor\.exe$/i.test(target)) {
    return findNativeAppById("cursor") ?? app;
  }
  return app;
}

/** Pick preferred IDE when set, else first installed IDE from registry. */
export function resolveIdeApp(): NativeAppEntry | null {
  for (const id of preferredIdeIds()) {
    const preferred = tryResolveIdeById(id);
    if (preferred) return preferred;
  }

  for (const id of IDE_CANDIDATE_IDS) {
    const app = tryResolveIdeById(id);
    if (app) return app;
  }
  return null;
}

export type ProjectPathResolution =
  | { status: "resolved"; path: string }
  | { status: "ambiguous"; candidates: string[]; question: string }
  | { status: "not_found" };

const PROJECT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  ".git",
];

export function looksLikeProjectRoot(dir: string): boolean {
  if (!dir || !existsSync(dir)) return false;
  return PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

export function findProjectRoot(startPath: string): string {
  let current = startPath.trim();
  if (!current) return startPath;

  if (existsSync(current)) {
    const stat = statSync(current);
    if (!stat.isDirectory()) {
      current = dirname(current);
    }
  } else {
    current = dirname(current);
  }

  for (let depth = 0; depth < 14; depth++) {
    if (looksLikeProjectRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return existsSync(startPath)
    ? statSync(startPath).isDirectory()
      ? startPath
      : dirname(startPath)
    : dirname(startPath);
}

type ScoredPath = { path: string; score: number };

function rankDirectoryHits(spoken: string, paths: string[]): ScoredPath[] {
  const label = folderLabelFromPath(spoken);
  const ranked = paths
    .map((path) => ({
      path,
      score: Math.max(
        scoreFolderNameMatch(spoken, folderLabelFromPath(path)),
        scoreFolderNameMatch(label, folderLabelFromPath(path)),
      ),
    }))
    .filter((r) => r.score >= 40)
    .sort((a, b) => b.score - a.score);

  const deduped = new Map<string, ScoredPath>();
  for (const hit of ranked) {
    const prev = deduped.get(hit.path);
    if (!prev || hit.score > prev.score) deduped.set(hit.path, hit);
  }
  return [...deduped.values()].sort((a, b) => b.score - a.score);
}

/** Match a spoken folder label to an on-disk sibling (spacing/punctuation only). */
function findCanonicalFolderMatch(
  parent: string,
  spokenLabel: string,
): string | null {
  if (!parent || !existsSync(parent)) return null;
  const want = normalizeFolderLabel(spokenLabel);
  if (!want) return null;

  try {
    for (const name of readdirSync(parent)) {
      const full = join(parent, name);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (normalizeFolderLabel(name) === want) return full;
    }
  } catch {
    /* skip */
  }
  return null;
}

function pickFromRanked(ranked: ScoredPath[]): ProjectPathResolution {
  if (!ranked.length) return { status: "not_found" };

  const top = ranked[0]!;
  // Exact / near-exact unique winner — never ask.
  if (top.score >= 92) {
    const exactPeers = ranked.filter((r) => r.score >= 92);
    if (exactPeers.length === 1) {
      return { status: "resolved", path: findProjectRoot(top.path) };
    }
  }

  const tied = ranked.filter((r) => r.score >= top.score - 3);
  if (tied.length === 1) {
    return { status: "resolved", path: findProjectRoot(top.path) };
  }

  const names = tied
    .slice(0, 5)
    .map((r) => folderLabelFromPath(r.path))
    .join(", ");
  return {
    status: "ambiguous",
    candidates: tied.map((r) => r.path),
    question: `Which project folder did you mean: ${names}?`,
  };
}

async function resolveFromSpokenReference(
  spoken: string,
): Promise<ProjectPathResolution> {
  const query = spoken.trim();
  if (!query) return { status: "not_found" };

  const indexed = searchIndexedDirectories(query, 16).map((r) => r.path);
  const fromIndex = rankDirectoryHits(query, indexed);
  if (fromIndex.length) {
    const picked = pickFromRanked(fromIndex);
    if (picked.status !== "not_found") return picked;
  }

  const retrieverHits = await searchItemsByNameAsync(query);
  const fromRetriever = rankDirectoryHits(query, retrieverHits);
  if (fromRetriever.length) {
    const picked = pickFromRanked(fromRetriever);
    if (picked.status !== "not_found") return picked;
  }

  const tokens = tokenizeFolderHint(query);
  if (tokens.length >= 2) {
    const tokenHits = searchIndexedDirectories(tokens.join(" "), 16).map(
      (r) => r.path,
    );
    const fromTokens = rankDirectoryHits(query, tokenHits);
    if (fromTokens.length) return pickFromRanked(fromTokens);
  }

  return { status: "not_found" };
}

export async function resolveProjectPathDetailed(args: {
  projectHint?: string;
  path?: string;
}): Promise<ProjectPathResolution> {
  const rawPath = args.path?.trim();
  if (rawPath) {
    const normalized = normalizeWindowsPath(rawPath);
    if (existsSync(normalized)) {
      return { status: "resolved", path: findProjectRoot(normalized) };
    }

    const label = folderLabelFromPath(normalized);
    const parent = dirname(normalized);
    const canonical = findCanonicalFolderMatch(parent, label);
    if (canonical) {
      return { status: "resolved", path: findProjectRoot(canonical) };
    }

    const parentExists = existsSync(parent);

    const localCandidates: string[] = [];
    if (parentExists) {
      try {
        for (const name of readdirSync(parent)) {
          const full = join(parent, name);
          try {
            if (statSync(full).isDirectory()) localCandidates.push(full);
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
    }

    const indexed = searchIndexedDirectories(label, 16).map((r) => r.path);
    const ranked = rankDirectoryHits(
      label,
      [...new Set([...localCandidates, ...indexed])],
    );
    if (ranked.length) {
      const picked = pickFromRanked(ranked);
      if (picked.status !== "not_found") return picked;
    }

    const fuzzy = await resolveFromSpokenReference(label);
    if (fuzzy.status !== "not_found") return fuzzy;
  }

  const hintRaw = args.projectHint?.trim();
  if (hintRaw) {
    let hint = hintRaw;
    try {
      hint = applyCorrectionsToUtterance(hintRaw);
    } catch {
      /* corrections optional */
    }
    const fuzzy = await resolveFromSpokenReference(hint);
    if (fuzzy.status !== "not_found") return fuzzy;
  }

  return { status: "not_found" };
}

export async function resolveProjectPath(args: {
  projectHint?: string;
  path?: string;
}): Promise<string | null> {
  const result = await resolveProjectPathDetailed(args);
  if (result.status === "resolved") return result.path;
  return null;
}

function isLaunchTargetUsable(target: string): boolean {
  if (!target.trim()) return false;
  if (target.endsWith(".exe")) return existsSync(target);
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  return existsSync(target);
}

function spawnDetached(exePath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.once("error", reject);
    child.unref();
    setImmediate(() => resolve());
  });
}

/** Launch a GUI IDE with the folder path as a single argv token (spaces-safe).
 * Uses --new-window so an already-open Cursor/VS Code workspace is not replaced.
 */
function launchIdeWithFolder(exePath: string, folderPath: string): Promise<void> {
  const isVscodeFamily = /(?:code|cursor)\.exe$/i.test(exePath);
  const args = isVscodeFamily
    ? ["--new-window", folderPath]
    : [folderPath];
  return spawnDetached(exePath, args);
}

function projectTitleHints(folderPath: string): string[] {
  const label = folderLabelFromPath(folderPath);
  const base = basename(folderPath);
  const hints = [label, base].filter(Boolean);
  // First token of "jkf ( funiture )" helps match truncated titles.
  const first = base.split(/\s+/).find((p) => p.length >= 2);
  if (first) hints.push(first.replace(/[()]/g, ""));
  return [...new Set(hints.map((h) => h.trim()).filter(Boolean))];
}

export async function openProjectInIde(
  projectPath: string,
  app: NativeAppEntry,
): Promise<string> {
  const folder = projectPath.trim();
  if (!folder || !existsSync(folder)) {
    throw new Error(`project_not_found:${folder || projectPath}`);
  }

  const target = resolveLaunchTarget(app);
  if (!isLaunchTargetUsable(target)) {
    throw new Error(`ide_not_found:${app.id}`);
  }

  const hints = projectTitleHints(folder);
  const alreadyOpen = await isAppWindowShowingTitle(app, hints).catch(
    () => false,
  );

  if (alreadyOpen) {
    console.info(
      `[ripple-desktop] Project already open in ${app.id} — focusing (skip relaunch)`,
    );
    try {
      await focusAppWindowPreferringTitle(app, hints);
    } catch {
      await focusAppWindow(app).catch(() => undefined);
    }
    return `Focused existing ${app.id} window: ${folder}`;
  }

  await launchIdeWithFolder(target, folder);
  await delay(3000);
  try {
    await focusAppWindowPreferringTitle(app, hints);
  } catch {
    try {
      await focusAppWindow(app);
    } catch {
      /* focus optional */
    }
  }
  return `Opened project in ${app.id}: ${folder}`;
}

/**
 * Open exact file at line in Cursor/VS Code (`--goto file:line`) and keep IDE foreground.
 */
export async function openFileAtLineInIde(
  filePath: string,
  line: number,
  app: NativeAppEntry,
  options?: { column?: number },
): Promise<string> {
  const abs = filePath.trim();
  if (!abs || !existsSync(abs)) {
    throw new Error(`file_not_found:${abs || filePath}`);
  }

  const target = resolveLaunchTarget(app);
  if (!isLaunchTargetUsable(target)) {
    throw new Error(`ide_not_found:${app.id}`);
  }

  const lineNo = Number.isFinite(line) && line > 0 ? Math.floor(line) : 1;
  const col =
    options?.column && options.column > 0 ? Math.floor(options.column) : 1;
  const gotoTarget = `${abs}:${lineNo}:${col}`;
  const isVscodeFamily = /(?:code|cursor)\.exe$/i.test(target);
  const args = isVscodeFamily
    ? ["--reuse-window", "--goto", gotoTarget]
    : [abs];

  console.info(
    `[ripple-desktop] IDE goto ${app.id}: ${gotoTarget}`,
  );
  await spawnDetached(target, args);
  await delay(500);

  const hints = [
    basename(abs),
    folderLabelFromPath(dirname(abs)),
    ...projectTitleHints(dirname(abs)),
  ];
  try {
    await focusAppWindowPreferringTitle(app, hints);
  } catch {
    try {
      await focusAppWindow(app);
    } catch {
      /* focus optional */
    }
  }

  // Second focus pass — Windows sometimes lets overlay/stealer win the race.
  await delay(350);
  try {
    await focusAppWindowPreferringTitle(app, hints);
  } catch {
    /* ignore */
  }

  return `Opened ${basename(abs)}:${lineNo} in ${app.id}`;
}
