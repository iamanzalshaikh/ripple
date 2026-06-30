import { existsSync } from "node:fs";
import {
  classifyOpenedPath,
  type OpenedItemKind,
} from "../automation/desktop/openedPathKind.js";
import { getRippleDb } from "./rippleDb.js";

export interface DesktopHistoryRow {
  id: number;
  command: string;
  intent: string | null;
  resolved_path: string | null;
  entities_json: string | null;
  result: string | null;
  status: string;
  created_at: string;
}

export function appendDesktopHistory(entry: {
  command: string;
  intent?: string | null;
  resolved_path?: string | null;
  entities_json?: string | null;
  result?: string | null;
  status: "ok" | "error";
}): void {
  const db = getRippleDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO desktop_history (command, intent, resolved_path, entities_json, result, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.command.slice(0, 2000),
    entry.intent ?? null,
    entry.resolved_path?.slice(0, 2000) ?? null,
    entry.entities_json?.slice(0, 4000) ?? null,
    entry.result?.slice(0, 4000) ?? null,
    entry.status,
    now,
  );
}

export function listDesktopHistory(limit = 50): DesktopHistoryRow[] {
  const db = getRippleDb();
  return db
    .prepare(
      `SELECT id, command, intent, resolved_path, entities_json, result, status, created_at
       FROM desktop_history
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as DesktopHistoryRow[];
}

/** Most recent successful open with a resolved path — recall fallback. */
export function getLastSuccessfulOpen(): DesktopHistoryRow | null {
  const db = getRippleDb();
  const row = db
    .prepare(
      `SELECT id, command, intent, resolved_path, entities_json, result, status, created_at
       FROM desktop_history
       WHERE status = 'ok' AND resolved_path IS NOT NULL AND resolved_path != ''
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get() as DesktopHistoryRow | undefined;
  return row ?? null;
}

/** Replay last successful command with same intent family. */
/** P8 — paths from successful opens in a time window (fallback when activity_log is sparse). */
export function searchDesktopHistoryPathsInRange(
  startMs: number,
  endMs: number,
  opts?: { extension?: string },
): string[] {
  const db = getRippleDb();
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const ext = opts?.extension?.trim().toLowerCase();

  const rows = db
    .prepare(
      `SELECT resolved_path, created_at
       FROM desktop_history
       WHERE status = 'ok'
         AND resolved_path IS NOT NULL
         AND resolved_path != ''
         AND created_at >= ?
         AND created_at < ?
       ORDER BY id DESC
       LIMIT 40`,
    )
    .all(startIso, endIso) as Array<{ resolved_path: string }>;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const path = row.resolved_path;
    if (ext && !path.toLowerCase().endsWith(`.${ext}`)) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

/** P8 — recent successful opens matching file extensions (recall video/image). */
export function searchRecentDesktopHistoryPathsByExtensions(
  extensions: string[],
  limit = 20,
): string[] {
  if (extensions.length === 0) return [];

  const db = getRippleDb();
  const exts = extensions.map((e) =>
    e.trim().toLowerCase().replace(/^\./, ""),
  );

  const rows = db
    .prepare(
      `SELECT resolved_path
       FROM desktop_history
       WHERE status = 'ok'
         AND resolved_path IS NOT NULL
         AND resolved_path != ''
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit * 4) as Array<{ resolved_path: string }>;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const path = row.resolved_path;
    const lower = path.toLowerCase();
    if (!exts.some((ext) => lower.endsWith(`.${ext}`))) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(path);
    if (out.length >= limit) break;
  }
  return out;
}

/** P8 — desktop_history paths in a time window by opened kind. */
export function searchDesktopHistoryPathsInRangeByKind(
  startMs: number,
  endMs: number,
  kind: OpenedItemKind,
): string[] {
  const db = getRippleDb();
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const rows = db
    .prepare(
      `SELECT resolved_path
       FROM desktop_history
       WHERE status = 'ok'
         AND resolved_path IS NOT NULL
         AND resolved_path != ''
         AND created_at >= ?
         AND created_at < ?
       ORDER BY id DESC
       LIMIT 80`,
    )
    .all(startIso, endIso) as Array<{ resolved_path: string }>;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const path = row.resolved_path;
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

/** P8 — recent successful opens by item kind (months of desktop_history). */
export function searchRecentDesktopHistoryPathsByKind(
  kind: OpenedItemKind,
  limit = 20,
): string[] {
  const db = getRippleDb();
  const rows = db
    .prepare(
      `SELECT resolved_path
       FROM desktop_history
       WHERE status = 'ok'
         AND resolved_path IS NOT NULL
         AND resolved_path != ''
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(Math.max(limit * 6, 120)) as Array<{ resolved_path: string }>;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const path = row.resolved_path;
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

export function getLastSuccessfulByIntent(intentPrefix: string): DesktopHistoryRow | null {
  const db = getRippleDb();
  const row = db
    .prepare(
      `SELECT id, command, intent, resolved_path, entities_json, result, status, created_at
       FROM desktop_history
       WHERE status = 'ok' AND intent LIKE ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(`${intentPrefix}%`) as DesktopHistoryRow | undefined;
  return row ?? null;
}

