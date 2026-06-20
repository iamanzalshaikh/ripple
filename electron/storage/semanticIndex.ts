import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { getRippleDb } from "./rippleDb.js";
import { tokenizeForSemantic } from "../automation/retriever/semanticScoring.js";

export type SemanticProfile = {
  path: string;
  label: string;
  tokens: string[];
  snippet: string;
  mtime: number;
};

function ensureTable(): void {
  getRippleDb();
}

function readSnippet(path: string): string {
  try {
    if (!existsSync(path)) return basename(path);
    const st = statSync(path);
    if (st.isDirectory()) return basename(path);
    if (st.size > 64_000) return basename(path);
    const raw = readFileSync(path, "utf8").slice(0, 2000);
    return `${basename(path)} ${raw}`.slice(0, 1500);
  } catch {
    return basename(path);
  }
}

export function upsertSemanticIndex(args: {
  path: string;
  command?: string;
  contact?: string;
  appId?: string;
}): void {
  ensureTable();
  if (!existsSync(args.path)) return;

  const label = basename(args.path);
  const snippet = [
    label,
    args.command ?? "",
    args.contact ?? "",
    args.appId ?? "",
    readSnippet(args.path),
  ]
    .join(" ")
    .slice(0, 2000);

  const tokens = tokenizeForSemantic(snippet);
  const mtime = statSync(args.path).mtimeMs;
  const now = new Date().toISOString();

  getRippleDb()
    .prepare(
      `INSERT INTO semantic_index (path, label, tokens, snippet, mtime, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         label = excluded.label,
         tokens = excluded.tokens,
         snippet = excluded.snippet,
         mtime = excluded.mtime,
         indexed_at = excluded.indexed_at`,
    )
    .run(args.path, label, JSON.stringify(tokens), snippet.slice(0, 2000), mtime, now);
}

export function getSemanticProfile(path: string): SemanticProfile | null {
  ensureTable();
  const row = getRippleDb()
    .prepare(
      `SELECT path, label, tokens, snippet, mtime FROM semantic_index WHERE path = ?`,
    )
    .get(path) as
    | {
        path: string;
        label: string;
        tokens: string;
        snippet: string;
        mtime: number;
      }
    | undefined;

  if (!row) return null;
  try {
    const tokens = JSON.parse(row.tokens) as string[];
    return {
      path: row.path,
      label: row.label,
      tokens: Array.isArray(tokens) ? tokens : tokenizeForSemantic(row.snippet),
      snippet: row.snippet,
      mtime: row.mtime,
    };
  } catch {
    return {
      path: row.path,
      label: row.label,
      tokens: tokenizeForSemantic(row.snippet),
      snippet: row.snippet,
      mtime: row.mtime,
    };
  }
}

export function searchSemanticIndex(phrase: string, limit = 20): SemanticProfile[] {
  ensureTable();
  const queryTokens = new Set(tokenizeForSemantic(phrase));
  if (queryTokens.size === 0) return [];

  const rows = getRippleDb()
    .prepare(`SELECT path, label, tokens, snippet, mtime FROM semantic_index LIMIT 500`)
    .all() as Array<{
    path: string;
    label: string;
    tokens: string;
    snippet: string;
    mtime: number;
  }>;

  const scored: Array<{ profile: SemanticProfile; score: number }> = [];

  for (const row of rows) {
    if (!existsSync(row.path)) continue;
    let tokens: string[];
    try {
      tokens = JSON.parse(row.tokens) as string[];
      if (!Array.isArray(tokens)) tokens = tokenizeForSemantic(row.snippet);
    } catch {
      tokens = tokenizeForSemantic(row.snippet);
    }

    let overlap = 0;
    for (const t of tokens) {
      if (queryTokens.has(t)) overlap++;
    }
    if (overlap === 0) continue;

    const score = overlap / Math.max(queryTokens.size, tokens.length);
    scored.push({
      profile: {
        path: row.path,
        label: row.label,
        tokens,
        snippet: row.snippet,
        mtime: row.mtime,
      },
      score,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.profile);
}

export function clearSemanticIndex(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM semantic_index`);
}
