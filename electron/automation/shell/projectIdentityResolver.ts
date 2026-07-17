import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { searchIndexedDirectories } from "../../storage/fileIndex.js";
import { getLastProjectPath } from "../../storage/workContext.js";
import { rankChoices } from "../../storage/usageStats.js";
import { dirname } from "node:path";
import {
  folderLabelFromPath,
  normalizeFolderLabel,
  scoreFolderNameMatch,
} from "./projectPathNormalize.js";
import { findProjectRoot, looksLikeProjectRoot } from "./projectResolver.js";

/**
 * Collapse a repo nested inside an identically-named container:
 * `…/school-management/school-management` → `…/school-management`.
 * The outer folder is what users name; the inner is a clone/init artifact.
 */
export function collapseDuplicateLeaf(path: string): string {
  const cleaned = path.trim().replace(/[\\/]+$/, "");
  const leaf = folderLabelFromPath(cleaned);
  const parent = dirname(cleaned);
  const parentLeaf = folderLabelFromPath(parent);
  if (
    leaf &&
    parentLeaf &&
    normalizeFolderLabel(leaf) === normalizeFolderLabel(parentLeaf) &&
    existsSync(parent)
  ) {
    return parent;
  }
  return cleaned;
}

export type ScoredProjectIdentity = {
  path: string;
  name: string;
  score: number;
  reasons: string[];
};

export type ProjectIdentityResult =
  | { status: "resolved"; path: string; name: string; score: number; auto: true }
  | {
      status: "confirm";
      path: string;
      name: string;
      score: number;
      question: string;
      candidates: ScoredProjectIdentity[];
    }
  | {
      status: "ambiguous";
      candidates: ScoredProjectIdentity[];
      question: string;
    }
  | { status: "not_found"; question: string };

const AUTO_THRESHOLD = 90;
const CONFIRM_THRESHOLD = 60;

function hasSrcFolder(dir: string): boolean {
  try {
    return existsSync(join(dir, "src")) && statSync(join(dir, "src")).isDirectory();
  } catch {
    return false;
  }
}

function recentlyModified(dir: string): boolean {
  try {
    const mtime = statSync(dir).mtimeMs;
    const ageDays = (Date.now() - mtime) / (1000 * 60 * 60 * 24);
    return ageDays <= 14;
  } catch {
    return false;
  }
}

function usageBoost(path: string): number {
  try {
    const ranked = rankChoices("path", [path]);
    const count = ranked[0]?.count ?? 0;
    if (count >= 3) return 20;
    if (count >= 1) return 12;
    return 0;
  } catch {
    return 0;
  }
}

/** Score a candidate folder for spoken project identity (0–100+). */
export function scoreProjectIdentity(
  spokenHint: string,
  candidatePath: string,
): ScoredProjectIdentity {
  const name = folderLabelFromPath(candidatePath);
  const spoken = normalizeFolderLabel(spokenHint);
  const folder = normalizeFolderLabel(name);
  const reasons: string[] = [];
  let score = 0;

  const nameScore = scoreFolderNameMatch(spokenHint, name);
  if (spoken === folder) {
    score += 50;
    reasons.push("exact_folder_name");
  } else if (nameScore >= 85) {
    score += 35;
    reasons.push("strong_name_match");
  } else if (nameScore >= 70) {
    score += 20;
    reasons.push("fuzzy_name_match");
  } else if (nameScore >= 40) {
    score += 8;
    reasons.push("weak_name_match");
  }

  const last = getLastProjectPath();
  if (last && normalizeFolderLabel(last) === normalizeFolderLabel(candidatePath)) {
    score += 20;
    reasons.push("previously_active");
  } else {
    const used = usageBoost(candidatePath);
    if (used > 0) {
      score += used;
      reasons.push("previously_opened");
    }
  }

  if (looksLikeProjectRoot(candidatePath)) {
    score += 15;
    reasons.push("project_markers");
  }
  if (hasSrcFolder(candidatePath)) {
    score += 10;
    reasons.push("has_src");
  }
  if (recentlyModified(candidatePath)) {
    score += 5;
    reasons.push("recent_mtime");
  }

  // Prefer shorter exact-ish names over longer prefix hits (school-management-old).
  if (spoken && folder.startsWith(spoken) && folder !== spoken) {
    score -= 18;
    reasons.push("longer_prefix_penalty");
  }

  return {
    path: collapseDuplicateLeaf(findProjectRoot(candidatePath)),
    name,
    score: Math.max(0, Math.min(100, score)),
    reasons,
  };
}

function collectCandidateDirs(hint: string): string[] {
  const spoken = hint.trim();
  if (!spoken) return [];
  const indexed = searchIndexedDirectories(spoken, 24).map((r) => r.path);
  const dirs: string[] = [];
  for (const p of indexed) {
    try {
      if (!existsSync(p)) continue;
      const st = statSync(p);
      if (st.isDirectory()) dirs.push(p);
      else dirs.push(findProjectRoot(p));
    } catch {
      /* skip */
    }
  }

  // Also scan common roots for exact folder name when index is noisy.
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  if (home) {
    for (const root of ["Desktop", "Documents", "Downloads"]) {
      const parent = join(home, root);
      try {
        if (!existsSync(parent)) continue;
        for (const name of readdirSync(parent)) {
          if (normalizeFolderLabel(name).includes(normalizeFolderLabel(spoken))) {
            const full = join(parent, name);
            try {
              if (statSync(full).isDirectory()) dirs.push(full);
            } catch {
              /* skip */
            }
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  return [
    ...new Set(dirs.map((d) => collapseDuplicateLeaf(findProjectRoot(d)))),
  ];
}

function formatConfirmQuestion(top: ScoredProjectIdentity): string {
  return `I found:\n${top.path}\n\nSave this as your main project?`;
}

function formatAmbiguousQuestion(cands: ScoredProjectIdentity[]): string {
  const lines = cands
    .slice(0, 5)
    .map((c, i) => `${i + 1}. ${c.path}`)
    .join("\n");
  return `Which project folder did you mean?\n${lines}`;
}

/**
 * P6 — resolve spoken project name → sticky workspace identity.
 * Auto-save when score ≥ 90; confirm at 60–89; ask path below 60.
 */
export function resolveProjectIdentity(spokenHint: string): ProjectIdentityResult {
  const hint = spokenHint.trim();
  if (!hint) {
    return {
      status: "not_found",
      question: "Which project should I remember? Give me a folder name or full path.",
    };
  }

  const raw = collectCandidateDirs(hint);
  const scored = raw
    .map((p) => scoreProjectIdentity(hint, p))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  // Dedup by path
  const deduped: ScoredProjectIdentity[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    const key = s.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  if (!deduped.length) {
    return {
      status: "not_found",
      question: `I couldn't find a project called "${hint}". What's the full path?`,
    };
  }

  const top = deduped[0]!;
  const close = deduped.filter((s) => s.score >= top.score - 8 && s.score >= CONFIRM_THRESHOLD);

  // Exact folder name unique winner → auto
  const exact = deduped.filter(
    (s) => normalizeFolderLabel(s.name) === normalizeFolderLabel(hint),
  );
  if (exact.length === 1 && exact[0]!.score >= CONFIRM_THRESHOLD) {
    const win = exact[0]!;
    if (win.score >= AUTO_THRESHOLD || close.length <= 1) {
      return {
        status: "resolved",
        path: win.path,
        name: win.name,
        score: win.score,
        auto: true,
      };
    }
  }

  if (top.score >= AUTO_THRESHOLD && close.length === 1) {
    return {
      status: "resolved",
      path: top.path,
      name: top.name,
      score: top.score,
      auto: true,
    };
  }

  if (top.score >= CONFIRM_THRESHOLD) {
    if (close.length === 1) {
      return {
        status: "confirm",
        path: top.path,
        name: top.name,
        score: top.score,
        question: formatConfirmQuestion(top),
        candidates: close,
      };
    }
    return {
      status: "ambiguous",
      candidates: close,
      question: formatAmbiguousQuestion(close),
    };
  }

  return {
    status: "not_found",
    question: `I couldn't confidently match "${hint}". What's the full path?`,
  };
}

export function basenameHint(pathOrName: string): string {
  return basename(pathOrName.trim()) || pathOrName.trim();
}
