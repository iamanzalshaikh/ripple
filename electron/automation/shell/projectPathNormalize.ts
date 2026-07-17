import { basename } from "node:path";
import { existsSync, statSync } from "node:fs";

/** Collapse spoken punctuation/spacing differences inside folder names. */
export function normalizeFolderLabel(name: string): string {
  return name
    .trim()
    .replace(/\\/g, "/")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .toLowerCase();
}

/** Strip trailing spoken clauses accidentally glued to an unquoted path. */
export function trimSpokenPathTail(path: string): string {
  let p = path.trim();
  if (!p) return p;

  // "...jkf (furniture). Check the entire codebase..."
  const afterParenPeriod = p.match(/^(.+?\))\s*\.(?:\s+.*)?$/);
  if (afterParenPeriod) return afterParenPeriod[1]!.trim();

  // "...Desktop\folder. Perform a full code audit..."
  const afterFolderPeriod = p.match(
    /^([A-Za-z]:\\.+?)\s*\.\s+(?:Check|Perform|Find|Run|Analyze|Inspect|Audit|Fix|Open)\b[\s\S]*$/i,
  );
  if (afterFolderPeriod) return afterFolderPeriod[1]!.trim();

  // "...path, find any existing code issues"
  const afterComma = p.match(
    /^(.+?)\s*[,;]\s*(?:and\s+)?(?:find|check|perform|run|analyze|inspect|audit|fix)\b[\s\S]*$/i,
  );
  if (afterComma) return afterComma[1]!.trim();

  // "C:\...\DEAL ROOm instead of detecting Aecci_main as ..."
  const afterEnglish = p.match(
    /^([A-Za-z]:\\.+?)\s+(?:instead|because|rather|while|where|when|why|how|versus|vs\.?|not|as|from|to|for|with|without|than|then|and|or|but|that|which|who|detecting|detect|should|must|will|would|can|could|is|are|was|were|using|runs?|running)\b[\s\S]*$/i,
  );
  if (afterEnglish) return afterEnglish[1]!.trim();

  return p;
}

/**
 * Keep only the longest prefix of a spoken path that exists on disk.
 * Prevents "C:\foo\bar instead of baz" from being used as projectRoot.
 */
export function clampToExistingPath(path: string): string {
  let p = normalizeWindowsPath(trimSpokenPathTail(path));
  if (!p) return p;
  try {
    if (existsSync(p) && statSync(p).isDirectory()) return p;
    while (p.length > 3) {
      const next = p.replace(/[\\/][^\\/]+$/, "");
      if (next === p) break;
      p = next;
      if (existsSync(p) && statSync(p).isDirectory()) return p;
    }
  } catch {
    /* ignore */
  }
  return normalizeWindowsPath(trimSpokenPathTail(path));
}

/** Normalize a Windows path from speech transcription. */
export function normalizeWindowsPath(path: string): string {
  let p = path.trim().replace(/\//g, "\\");
  p = p.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  p = p.replace(/\s{2,}/g, " ");
  p = p.replace(/\\+\s*,\s*/g, "\\");
  return p.trim();
}

export function folderLabelFromPath(path: string): string {
  const cleaned = path.trim().replace(/[\\/,]+$/, "");
  return basename(cleaned);
}

export function tokenizeFolderHint(hint: string): string[] {
  return normalizeFolderLabel(hint)
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length]!;
}

export function scoreFolderNameMatch(spoken: string, candidate: string): number {
  const a = normalizeFolderLabel(spoken);
  const b = normalizeFolderLabel(candidate);
  if (!a || !b) return 0;
  if (a === b) return 100;

  // Substring / prefix matches: require similar length so "school-m" ≠ "school-management".
  if (b.includes(a) || a.includes(b)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    const ratio = shorter / longer;
    if (ratio >= 0.9) return 92;
    if (ratio >= 0.75) return 80;
    if (b.startsWith(a) || a.startsWith(b)) return 55;
    return 65;
  }

  const aTokens = tokenizeFolderHint(a);
  const bTokens = tokenizeFolderHint(b);
  if (aTokens.length && aTokens.every((t) => b.includes(t))) return 78;

  const dist = levenshtein(a.replace(/\s/g, ""), b.replace(/\s/g, ""));
  const maxLen = Math.max(a.replace(/\s/g, "").length, b.replace(/\s/g, "").length);
  if (maxLen > 0 && dist <= 2) return 70 - dist * 5;
  if (maxLen > 0 && dist <= 4) return 45 - dist * 3;
  return 0;
}
