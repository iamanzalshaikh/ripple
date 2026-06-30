import { basename } from "node:path";
import { existsSync } from "node:fs";
import { extractContactName } from "../automation/adapters/whatsapp/parseContact.js";
import {
  classifyOpenedPath,
  type OpenedItemKind,
} from "../automation/desktop/openedPathKind.js";
import { getRippleDb } from "./rippleDb.js";

export type ActivityLogEntry = {
  id: number;
  path: string | null;
  app_id: string | null;
  contact: string | null;
  command: string;
  summary: string | null;
  created_at: string;
};

function ensureTable(): void {
  getRippleDb();
}

export function appendActivityLog(entry: {
  path?: string | null;
  app_id?: string | null;
  contact?: string | null;
  command: string;
  summary?: string | null;
}): void {
  ensureTable();
  const path = entry.path?.slice(0, 2000) ?? null;
  if (path && shouldSkipDuplicateActivity(path, entry.command)) {
    return;
  }

  const now = new Date().toISOString();
  getRippleDb()
    .prepare(
      `INSERT INTO activity_log (path, app_id, contact, command, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      path,
      entry.app_id?.slice(0, 120) ?? null,
      entry.contact?.trim().toLowerCase().slice(0, 120) ?? null,
      entry.command.slice(0, 2000),
      entry.summary?.slice(0, 500) ?? null,
      now,
    );
}

/** Skip repeated focus/view logs for the same path within a short window. */
const ACTIVITY_DEDUPE_MS = 3 * 60 * 1000;

function shouldSkipDuplicateActivity(path: string, command: string): boolean {
  const row = getRippleDb()
    .prepare(
      `SELECT command, created_at FROM activity_log
       WHERE lower(path) = lower(?) ORDER BY id DESC LIMIT 1`,
    )
    .get(path.trim()) as { command: string; created_at: string } | undefined;

  if (!row?.created_at) return false;

  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > ACTIVITY_DEDUPE_MS) return false;

  const prev = row.command.toLowerCase();
  const next = command.toLowerCase();
  const isViewish = (c: string) =>
    /\bviewed\b/i.test(c) ||
    /\btouched:/i.test(c) ||
    /\bfocus\b/i.test(c);

  if (isViewish(prev) && isViewish(next)) return true;
  if (prev === next) return true;
  return false;
}

/** Prune activity rows older than retention (default 9 months). Returns deleted count. */
export function pruneActivityLogOlderThan(
  retentionMonths = 9,
): number {
  ensureTable();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - Math.max(1, retentionMonths));
  const cutoffIso = cutoff.toISOString();

  const result = getRippleDb()
    .prepare(`DELETE FROM activity_log WHERE created_at < ?`)
    .run(cutoffIso);

  const deleted = result.changes ?? 0;
  if (deleted > 0) {
    console.info(
      `[ripple-desktop] activity_log pruned → ${deleted} row(s) older than ${retentionMonths}mo`,
    );
  }
  return deleted;
}

/** P8 — paths tied to a person or vague topic from past commands. */
function contactNeedlesFromPhrase(phrase: string): string[] {
  const needles = new Set<string>();
  const lower = phrase.trim().toLowerCase();
  if (!lower) return [];

  const patterns = [
    /\b(?:with|from|to|by)\s+([a-z][a-z0-9_.'-]{1,30})\b/gi,
    /\b(?:discussed|shared|sent)\s+(?:with|to)\s+([a-z][a-z0-9_.'-]{1,30})\b/gi,
  ];

  for (const re of patterns) {
    for (const m of lower.matchAll(re)) {
      const name = m[1]?.trim().toLowerCase();
      if (name && name.length >= 2) needles.add(name);
    }
  }

  const fromCommand = extractContactName(phrase);
  if (fromCommand) needles.add(fromCommand.toLowerCase());

  return [...needles];
}

export function searchActivityPathsInRange(
  startMs: number,
  endMs: number,
  opts?: { extension?: string },
): string[] {
  ensureTable();
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const ext = opts?.extension?.trim().toLowerCase();

  const rows = getRippleDb()
    .prepare(
      `SELECT path, command, summary, created_at
       FROM activity_log
       WHERE path IS NOT NULL
         AND created_at >= ?
         AND created_at < ?
       ORDER BY id DESC
       LIMIT 40`,
    )
    .all(startIso, endIso) as Array<{ path: string }>;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (ext && !row.path.toLowerCase().endsWith(`.${ext}`)) continue;
    const key = row.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.path);
  }
  return out;
}

/** P8 — activity paths in a time window filtered by opened kind (image, video, pdf, …). */
export function searchActivityPathsInRangeByKind(
  startMs: number,
  endMs: number,
  kind: OpenedItemKind,
): string[] {
  ensureTable();
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const rows = getRippleDb()
    .prepare(
      `SELECT path FROM activity_log
       WHERE path IS NOT NULL
         AND created_at >= ?
         AND created_at < ?
       ORDER BY id DESC
       LIMIT 80`,
    )
    .all(startIso, endIso) as Array<{ path: string }>;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const path = row.path;
    if (!path || !existsSync(path)) continue;
    const classified = classifyOpenedPath(path);
    if (kind === "file") {
      if (classified !== "file") continue;
    } else if (classified !== kind) {
      continue;
    }
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export function searchActivityByPhrase(phrase: string, limit = 12): string[] {
  ensureTable();
  const needle = phrase.trim().toLowerCase();
  if (!needle) return [];

  const contactNeedles = contactNeedlesFromPhrase(phrase);
  const primaryContact = contactNeedles[0] ?? "";

  const rows = getRippleDb()
    .prepare(
      `SELECT path, contact, command, summary, created_at
       FROM activity_log
       WHERE path IS NOT NULL
         AND (
           command LIKE '%' || ? || '%'
           OR summary LIKE '%' || ? || '%'
           OR (? != '' AND contact LIKE '%' || ? || '%')
           OR (? != '' AND command LIKE '%' || ? || '%')
         )
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(
      needle,
      needle,
      primaryContact,
      primaryContact,
      primaryContact,
      primaryContact,
      limit * 4,
    ) as Array<{
    path: string;
    contact: string | null;
  }>;

  const seen = new Set<string>();
  const scored: Array<{ path: string; score: number }> = [];

  for (const row of rows) {
    const key = row.path.toLowerCase();
    if (seen.has(key)) continue;

    let score = 1;
    const contact = row.contact?.toLowerCase() ?? "";

    for (const c of contactNeedles) {
      if (contact.includes(c)) score += 3;
    }

    seen.add(key);
    scored.push({ path: row.path, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.path);
}

function filterRecentPathsByExtensions(
  rows: Array<{ path: string }>,
  extensions: string[],
  limit: number,
): string[] {
  const exts = extensions.map((e) =>
    e.trim().toLowerCase().replace(/^\./, ""),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const lower = row.path.toLowerCase();
    if (!exts.some((ext) => lower.endsWith(`.${ext}`))) continue;
    const key = lower;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.path);
    if (out.length >= limit) break;
  }
  return out;
}

/** Recent opened paths (any time) — used for temporal clarify fallback. */
export function searchRecentOpenedPathsByExtension(
  extension: string,
  limit = 20,
): string[] {
  ensureTable();
  const ext = extension.trim().toLowerCase().replace(/^\./, "");
  const rows = getRippleDb()
    .prepare(
      `SELECT path FROM activity_log
       WHERE path IS NOT NULL
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit * 4) as Array<{ path: string }>;

  return filterRecentPathsByExtensions(rows, [ext], limit);
}

/** P8 — most recently opened paths matching any of the given extensions. */
export function searchRecentOpenedPathsByExtensions(
  extensions: string[],
  limit = 20,
): string[] {
  ensureTable();
  if (extensions.length === 0) return [];

  const rows = getRippleDb()
    .prepare(
      `SELECT path FROM activity_log
       WHERE path IS NOT NULL
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit * 4) as Array<{ path: string }>;

  return filterRecentPathsByExtensions(rows, extensions, limit);
}

/** P8 — most recent path of a kind (pdf, image, video, folder, file) from activity_log. */
export function searchRecentOpenedPathsByKind(
  kind: OpenedItemKind,
  limit = 20,
): string[] {
  ensureTable();
  const rows = getRippleDb()
    .prepare(
      `SELECT path FROM activity_log
       WHERE path IS NOT NULL
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(Math.max(limit * 6, 120)) as Array<{ path: string }>;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const path = row.path;
    if (!path || !existsSync(path)) continue;
    const classified = classifyOpenedPath(path);
    if (kind === "file") {
      if (classified !== "file") continue;
    } else if (classified !== kind) {
      continue;
    }
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
    if (out.length >= limit) break;
  }
  return out;
}

export function listRecentActivity(limit = 50): ActivityLogEntry[] {
  ensureTable();
  return getRippleDb()
    .prepare(
      `SELECT id, path, app_id, contact, command, summary, created_at
       FROM activity_log ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as ActivityLogEntry[];
}

export function summarizeActivity(path: string, command: string): string {
  const name = basename(path);
  return `${name} — ${command.slice(0, 80)}`;
}

export function clearActivityLog(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM activity_log`);
}
