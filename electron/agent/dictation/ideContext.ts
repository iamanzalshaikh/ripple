import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, dirname, join } from "path";
import { getFocusContext } from "../../focus/focusContext.js";

export type WorkspaceFile = {
  basename: string;
  path: string;
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "target",
  ".next",
  "coverage",
  "build",
]);

const WORKSPACE_CACHE_MS = 20_000;
let workspaceCache: {
  at: number;
  project: string;
  files: WorkspaceFile[];
} | null = null;

export function isCursorOrWindsurf(processName?: string | null): boolean {
  const p = (processName ?? "").toLowerCase();
  return p === "cursor" || p.includes("windsurf");
}

export function isIdeProcess(processName?: string | null): boolean {
  const p = (processName ?? "").toLowerCase();
  return (
    isCursorOrWindsurf(p) ||
    p === "code" ||
    p.includes("vscode") ||
    p.includes("visual studio code")
  );
}

export function parseIdeWindowTitle(title: string): {
  projectName: string | null;
  openedFile: string | null;
} {
  const parts = title
    .split(/\s[-–—]\s/g)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { projectName: null, openedFile: null };
  const last = parts[parts.length - 1]?.toLowerCase() ?? "";
  if (last === "cursor" || last === "visual studio code" || last === "windsurf") {
    parts.pop();
  }
  if (parts.length >= 2) {
    return {
      openedFile: parts.slice(0, -1).join(" - "),
      projectName: parts[parts.length - 1] ?? null,
    };
  }
  return { projectName: parts[0] ?? null, openedFile: null };
}

function candidateWorkspaceRoots(projectName: string): string[] {
  const roots = new Set<string>();
  const normalized = projectName.toLowerCase();
  let dir = process.cwd();
  for (let i = 0; i < 8 && dir && dir !== dirname(dir); i++) {
    if (basename(dir).toLowerCase() === normalized) roots.add(dir);
    dir = dirname(dir);
  }
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    for (const base of [
      home,
      join(home, "Desktop"),
      join(home, "Documents"),
      join(home, "Projects"),
    ]) {
      const direct = join(base, projectName);
      if (existsSync(direct)) roots.add(direct);
    }
  }
  return [...roots];
}

export function resolveOpenIdeFilePath(
  processName?: string | null,
  windowTitle?: string | null,
): string | null {
  const focus = getFocusContext();
  const proc = processName ?? focus?.processName ?? "";
  const title = windowTitle ?? focus?.windowTitle ?? "";
  if (!isIdeProcess(proc)) return null;

  const parsed = parseIdeWindowTitle(title);
  const opened = parsed.openedFile?.replace(/\s+\(.*?\)\s*$/, "").trim();
  if (!opened || !parsed.projectName) return null;

  const base = basename(opened);
  for (const root of candidateWorkspaceRoots(parsed.projectName)) {
    const candidates = [
      join(root, opened),
      join(root, base),
      join(root, "src", base),
      join(root, "electron", base),
      join(root, "ripple-desktop", base),
      join(root, "ripple-desktop", "electron", base),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  return null;
}

export function readOpenIdeFileContent(
  processName?: string | null,
  windowTitle?: string | null,
  maxChars = 80_000,
): string | null {
  try {
    const path = resolveOpenIdeFilePath(processName, windowTitle);
    if (!path) return null;
    return readFileSync(path, "utf8").slice(0, maxChars);
  } catch {
    return null;
  }
}

export function getOpenFileBasename(
  processName?: string | null,
  windowTitle?: string | null,
): string | null {
  const focus = getFocusContext();
  const title = windowTitle ?? focus?.windowTitle ?? "";
  const proc = processName ?? focus?.processName ?? "";
  if (!isIdeProcess(proc)) return null;
  const opened = parseIdeWindowTitle(title).openedFile;
  if (!opened) return null;
  return opened.replace(/\s+\(.*?\)\s*$/, "").trim();
}

function walkSourceFiles(
  dir: string,
  depth: number,
  files: WorkspaceFile[],
  seen: Set<string>,
): void {
  if (depth < 0 || !existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, depth - 1, files, seen);
      continue;
    }
    if (!entry.isFile() || !/\.[A-Za-z0-9]{1,8}$/.test(entry.name)) continue;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    files.push({ basename: entry.name, path: full });
  }
}

/** Cached basename list for the Cursor/VS Code project in the window title. */
export function listWorkspaceSourceFiles(
  processName?: string | null,
  windowTitle?: string | null,
): WorkspaceFile[] {
  if (!isIdeProcess(processName)) return [];
  const focus = getFocusContext();
  const title = windowTitle ?? focus?.windowTitle ?? "";
  const project = parseIdeWindowTitle(title).projectName;
  if (!project) return [];
  if (
    workspaceCache &&
    workspaceCache.project === project &&
    Date.now() - workspaceCache.at < WORKSPACE_CACHE_MS
  ) {
    return workspaceCache.files;
  }
  const files: WorkspaceFile[] = [];
  const seen = new Set<string>();
  for (const root of candidateWorkspaceRoots(project)) {
    walkSourceFiles(root, 8, files, seen);
  }
  workspaceCache = { at: Date.now(), project, files };
  return files;
}

export function findWorkspaceBasename(
  spoken: string,
  processName?: string | null,
): string | null {
  const want = spoken.replace(/^@/, "").trim().toLowerCase();
  if (!want) return null;
  const stem = want.replace(/\.[^.]+$/, "");
  for (const file of listWorkspaceSourceFiles(processName)) {
    const lower = file.basename.toLowerCase();
    if (lower === want) return file.basename;
    if (lower.replace(/\.[^.]+$/, "") === stem && !want.includes(".")) {
      return file.basename;
    }
  }
  return null;
}

export function readWorkspaceFileByBasename(
  name: string,
  processName?: string | null,
  maxChars = 80_000,
): string | null {
  const want = name.replace(/^@/, "").trim().toLowerCase();
  if (!want) return null;
  const hit = listWorkspaceSourceFiles(processName).find(
    (f) => f.basename.toLowerCase() === want,
  );
  if (!hit) return null;
  try {
    return readFileSync(hit.path, "utf8").slice(0, maxChars);
  } catch {
    return null;
  }
}
