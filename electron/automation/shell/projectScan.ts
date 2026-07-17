import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "out",
  ".turbo",
  ".cache",
]);

export const PRIORITY_RELATIVE_PATHS = [
  "package.json",
  "tsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "prisma/schema.prisma",
  ".env",
  ".env.example",
  ".env.local",
] as const;

export const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".prisma",
  ".env",
]);

export function shouldIgnoreDirName(name: string): boolean {
  return IGNORED_DIR_NAMES.has(name);
}

export function shouldIgnorePath(fullPath: string): boolean {
  const parts = fullPath.split(/[/\\]/);
  return parts.some((part) => shouldIgnoreDirName(part));
}

export function resolvePriorityFiles(projectRoot: string): {
  rel: string;
  path: string;
  exists: boolean;
}[] {
  return PRIORITY_RELATIVE_PATHS.map((rel) => {
    const path = join(projectRoot, rel);
    return { rel, path, exists: existsSync(path) };
  });
}

export type ProjectFileEntry = {
  path: string;
  rel: string;
  area: string;
};

function areaFromRel(rel: string): string {
  const norm = rel.replace(/\\/g, "/");
  const parts = norm.split("/");
  if (parts[0] === "src" && parts.length >= 2) {
    return `src/${parts[1]}`;
  }
  if (parts[0] === "prisma") return "prisma";
  if (parts[0] === "app") return "app";
  return parts[0] ?? ".";
}

export function listProjectSourceFiles(
  projectRoot: string,
  options?: { maxFiles?: number },
): ProjectFileEntry[] {
  const maxFiles = options?.maxFiles ?? 200;
  const files: ProjectFileEntry[] = [];
  const stack = [projectRoot];

  while (stack.length > 0 && files.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      if (files.length >= maxFiles) break;
      if (shouldIgnoreDirName(name)) continue;

      const full = join(dir, name);
      if (shouldIgnorePath(full)) continue;

      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }

      const ext = name.includes(".")
        ? name.slice(name.lastIndexOf(".")).toLowerCase()
        : "";
      if (!SCAN_EXTENSIONS.has(ext)) continue;

      const rel = relative(projectRoot, full);
      files.push({ path: full, rel, area: areaFromRel(rel) });
    }
  }

  return files;
}

export function readTextFile(path: string, maxBytes = 120_000): string | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const PACKAGE_MARKERS = [
  "package.json",
  "tsconfig.json",
  "tsconfig.app.json",
  "jsconfig.json",
] as const;

export function hasPackageMarker(dir: string): boolean {
  return PACKAGE_MARKERS.some((m) => existsSync(join(dir, m)));
}

/**
 * Resolve the effective package root(s) for a workspace.
 * Monorepos (e.g. a folder holding `Aecci_main`, `Aecci_back`) have no
 * root package.json/tsconfig — the real projects live one or two levels down.
 * Returns the given root when it is itself a package, else the nested
 * package roots (depth-limited), else an empty array.
 */
export function findPackageRoots(
  projectRoot: string,
  maxDepth = 2,
): string[] {
  const root = projectRoot.trim();
  if (!root || !existsSync(root)) return [];
  if (hasPackageMarker(root)) return [root];

  const found: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (shouldIgnoreDirName(name)) continue;
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (hasPackageMarker(full)) {
        found.push(full);
        continue; // don't descend into a resolved package
      }
      visit(full, depth + 1);
    }
  };
  visit(root, 1);
  return found;
}

const PROJECT_MARKERS: { name: string; score: number; dir?: boolean }[] = [
  { name: "tsconfig.app.json", score: 40 },
  { name: "package.json", score: 30 },
  { name: "tsconfig.json", score: 25 },
  { name: "jsconfig.json", score: 20 },
  { name: "vite.config.ts", score: 20 },
  { name: "vite.config.js", score: 20 },
  { name: "vite.config.mjs", score: 20 },
  { name: "next.config.ts", score: 20 },
  { name: "next.config.js", score: 20 },
  { name: "next.config.mjs", score: 20 },
  { name: "node_modules", score: 15, dir: true },
  { name: "src", score: 10, dir: true },
];

export type ResolvedAutomationRoot = {
  root: string;
  confidence: number;
  markersFound: string[];
  requested: string;
};

function scorePackageDir(dir: string): { score: number; markers: string[] } {
  const markers: string[] = [];
  let score = 0;
  for (const m of PROJECT_MARKERS) {
    const full = join(dir, m.name);
    if (!existsSync(full)) continue;
    if (m.dir) {
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
    }
    markers.push(m.name);
    score += m.score;
  }
  return { score, markers };
}

/**
 * Resolve the strongest TypeScript/JS package root for automation tools.
 * Always re-scores the requested folder and nested children — does not
 * blindly trust inherited workspace roots like a monorepo parent folder.
 */
export function resolveAutomationProjectRoot(
  projectRoot: string,
  hintPath?: string | null,
): ResolvedAutomationRoot | null {
  const requested = projectRoot.trim();
  if (!requested || !existsSync(requested)) return null;

  const candidates = new Set<string>([requested, ...findPackageRoots(requested)]);
  const hint = (hintPath ?? "").trim().replace(/\\/g, "/").toLowerCase();

  let bestDir = requested;
  let bestScore = -1;
  let bestMarkers: string[] = [];

  for (const dir of candidates) {
    const { score, markers } = scorePackageDir(dir);
    let boosted = score;
    const found = [...markers];

    if (hint) {
      const normRoot = dir.replace(/\\/g, "/").toLowerCase();
      if (
        hint === normRoot ||
        hint.startsWith(normRoot.endsWith("/") ? normRoot : `${normRoot}/`)
      ) {
        boosted += 50;
        found.push("hint:open_file");
      }
    }

    // Empty workspace shells lose to nested packages.
    if (dir === requested && markers.length === 0) boosted -= 20;

    if (boosted > bestScore) {
      bestScore = boosted;
      bestDir = dir;
      bestMarkers = found;
    }
  }

  const confidence =
    bestScore < 0
      ? 0.2
      : Math.min(0.99, Math.max(0.15, bestScore / 120));

  const result: ResolvedAutomationRoot = {
    root: bestDir,
    confidence,
    markersFound: bestMarkers,
    requested,
  };

  console.info(
    `[ripple-context] detected_root=${result.root} confidence=${result.confidence.toFixed(2)} markers_found=${result.markersFound.join(",") || "-"}`,
  );

  return result;
}

/** Convenience: path only (null when requested path missing). */
export function resolvePrimaryPackageRoot(
  projectRoot: string,
  hintPath?: string | null,
): string | null {
  return resolveAutomationProjectRoot(projectRoot, hintPath)?.root ?? null;
}

export function sortFilesForAnalysis(files: ProjectFileEntry[]): ProjectFileEntry[] {
  const score = (rel: string): number => {
    const n = rel.replace(/\\/g, "/").toLowerCase();
    if (PRIORITY_RELATIVE_PATHS.some((p) => n === p || n.endsWith(`/${p}`))) return 0;
    if (n.includes("/api/")) return 10;
    if (n.startsWith("src/lib/")) return 20;
    if (n.includes("auth") || n.includes("guard")) return 25;
    if (n.includes("upload")) return 30;
    if (n.startsWith("src/components/")) return 40;
    if (n.startsWith("src/app/")) return 50;
    if (n.startsWith("src/")) return 60;
    return 80;
  };

  return [...files].sort((a, b) => score(a.rel) - score(b.rel) || a.rel.localeCompare(b.rel));
}
