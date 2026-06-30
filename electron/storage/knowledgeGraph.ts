import { existsSync, statSync } from "node:fs";
import { getRippleDb } from "./rippleDb.js";
import { compositeScore } from "./graphScoring.js";
import { appMatchesRole, parseAppRolePhrase } from "../automation/desktop/appRoles.js";

export type KnowledgeEntity = {
  key: string;
  path: string;
  type: "file" | "folder" | "project" | "app" | "app_role" | "workflow";
  composite_score: number;
  open_count?: number;
};

const NON_PATH_TYPES = new Set<KnowledgeEntity["type"]>([
  "app",
  "app_role",
  "workflow",
]);

function ensureTable(): void {
  getRippleDb();
}

function pathStillValid(path: string, type: KnowledgeEntity["type"]): boolean {
  if (NON_PATH_TYPES.has(type)) return Boolean(path?.trim());
  return existsSync(path);
}

function rowToEntity(row: {
  canonical_key: string;
  type: string;
  resolved_path: string | null;
  composite_score: number;
  open_count: number;
  last_opened_at: string | null;
  confirmed_at: string | null;
}): KnowledgeEntity | null {
  if (!row.resolved_path) return null;
  const type = row.type as KnowledgeEntity["type"];
  if (!pathStillValid(row.resolved_path, type)) return null;

  const lastMs = row.last_opened_at ? Date.parse(row.last_opened_at) : null;
  const confirmedMs = row.confirmed_at ? Date.parse(row.confirmed_at) : null;
  const score = compositeScore({
    openCount: row.open_count,
    lastOpenedAtMs: lastMs,
    confirmedAtMs: confirmedMs,
  });
  return {
    key: row.canonical_key,
    path: row.resolved_path,
    type,
    composite_score: score,
    open_count: row.open_count,
  };
}

export function rememberEntity(entity: KnowledgeEntity): void {
  ensureTable();
  const now = new Date().toISOString();
  getRippleDb()
    .prepare(
      `INSERT INTO knowledge_entity
        (canonical_key, type, resolved_path, composite_score, open_count, last_opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(canonical_key) DO UPDATE SET
         type = excluded.type,
         resolved_path = excluded.resolved_path,
         composite_score = excluded.composite_score,
         open_count = excluded.open_count,
         last_opened_at = excluded.last_opened_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      entity.key.trim().toLowerCase(),
      entity.type,
      entity.path,
      entity.composite_score,
      entity.open_count ?? 1,
      now,
      now,
    );
}

export function confirmEntity(key: string): void {
  ensureTable();
  const now = new Date().toISOString();
  getRippleDb()
    .prepare(
      `UPDATE knowledge_entity SET confirmed_at = ?, updated_at = ? WHERE canonical_key = ?`,
    )
    .run(now, now, key.trim().toLowerCase());
}

function inferEntityType(key: string, path: string): KnowledgeEntity["type"] {
  const normalized = key.trim().toLowerCase();
  let isDir = false;
  try {
    isDir = existsSync(path) && statSync(path).isDirectory();
  } catch {
    /* keep file */
  }
  if (!isDir) return "file";
  if (
    normalized === "project" ||
    normalized === "my project" ||
    normalized.endsWith(" project")
  ) {
    return "project";
  }
  return "folder";
}

function rememberBoostedEntity(
  key: string,
  path: string,
  type: KnowledgeEntity["type"],
  openCount: number,
  confirmed: boolean,
): void {
  const score = compositeScore({
    openCount,
    lastOpenedAtMs: Date.now(),
    confirmedAtMs: confirmed ? Date.now() : null,
  });
  rememberEntity({
    key,
    path,
    type,
    composite_score: score,
    open_count: openCount,
  });
}

export function boostEntityFromOpen(key: string, path: string): void {
  ensureTable();
  const normalized = key.trim().toLowerCase();
  const existing = lookupEntity(normalized);
  const openCount = (existing?.open_count ?? 0) + 1;
  const type = inferEntityType(normalized, path);
  rememberBoostedEntity(normalized, path, type, openCount, Boolean(existing));

  if (!normalized.startsWith("my ") && normalized.length >= 3) {
    const myKey = `my ${normalized}`;
    const myExisting = lookupEntity(myKey);
    const myCount = (myExisting?.open_count ?? 0) + 1;
    rememberBoostedEntity(myKey, path, type, myCount, Boolean(myExisting));
  } else if (normalized.startsWith("my ")) {
    const stripped = normalized.slice(3).trim();
    if (stripped.length >= 2) {
      const strippedExisting = lookupEntity(stripped);
      const strippedCount = (strippedExisting?.open_count ?? 0) + 1;
      rememberBoostedEntity(
        stripped,
        path,
        type,
        strippedCount,
        Boolean(strippedExisting),
      );
    }
  }
}

/** P5.5 — learn native app launches for role-based recall. */
export function boostAppFromLaunch(appId: string, spokenKey?: string): void {
  ensureTable();
  const id = appId.trim().toLowerCase();
  const existing = lookupEntity(id);
  const openCount = (existing?.open_count ?? 0) + 1;
  const score = compositeScore({
    openCount,
    lastOpenedAtMs: Date.now(),
  });
  rememberEntity({
    key: id,
    path: id,
    type: "app",
    composite_score: score,
    open_count: openCount,
  });

  const roleKey = spokenKey ? parseAppRolePhrase(spokenKey) : null;
  if (roleKey && appMatchesRole(id, roleKey)) {
    const roleExisting = lookupEntity(roleKey);
    const roleCount = (roleExisting?.open_count ?? 0) + 1;
    rememberEntity({
      key: roleKey,
      path: id,
      type: "app_role",
      composite_score: compositeScore({
        openCount: roleCount,
        lastOpenedAtMs: Date.now(),
        confirmedAtMs: roleExisting ? Date.now() : null,
      }),
      open_count: roleCount,
    });
  }
}

export function rememberWorkflowEntity(name: string, stepCount: number): void {
  rememberEntity({
    key: normalizeWorkflowKey(name),
    path: name.trim().toLowerCase(),
    type: "workflow",
    composite_score: compositeScore({
      openCount: stepCount,
      lastOpenedAtMs: Date.now(),
    }),
    open_count: 1,
  });
}

function normalizeWorkflowKey(name: string): string {
  return `workflow:${name.trim().toLowerCase()}`;
}

export function lookupEntity(key: string): KnowledgeEntity | null {
  ensureTable();
  const row = getRippleDb()
    .prepare(
      `SELECT canonical_key, type, resolved_path, composite_score, open_count,
              last_opened_at, confirmed_at
       FROM knowledge_entity WHERE canonical_key = ?`,
    )
    .get(key.trim().toLowerCase()) as
    | {
        canonical_key: string;
        type: string;
        resolved_path: string | null;
        composite_score: number;
        open_count: number;
        last_opened_at: string | null;
        confirmed_at: string | null;
      }
    | undefined;
  if (!row) return null;
  return rowToEntity(row);
}

export function lookupAppRole(spoken: string): KnowledgeEntity | null {
  const roleKey = parseAppRolePhrase(spoken);
  if (!roleKey) return null;

  const direct = lookupEntity(roleKey);
  if (direct?.type === "app_role") return direct;

  const ranked = rankEntitiesByType("app")
    .filter((e) => appMatchesRole(e.path, roleKey))
    .sort((a, b) => b.composite_score - a.composite_score);

  return ranked[0] ?? null;
}

export function rankEntitiesByType(
  type: KnowledgeEntity["type"],
): KnowledgeEntity[] {
  ensureTable();
  const rows = getRippleDb()
    .prepare(
      `SELECT canonical_key, type, resolved_path, composite_score, open_count,
              last_opened_at, confirmed_at
       FROM knowledge_entity
       WHERE type = ?
       LIMIT 50`,
    )
    .all(type) as Array<Parameters<typeof rowToEntity>[0]>;

  return rows
    .map((r) => rowToEntity(r))
    .filter((e): e is KnowledgeEntity => e !== null)
    .sort((a, b) => b.composite_score - a.composite_score);
}

export function rankEntities(key: string): KnowledgeEntity[] {
  ensureTable();
  const needle = key.trim().toLowerCase();
  const rows = getRippleDb()
    .prepare(
      `SELECT canonical_key, type, resolved_path, composite_score, open_count,
              last_opened_at, confirmed_at
       FROM knowledge_entity
       WHERE canonical_key LIKE '%' || ? || '%'
       LIMIT 20`,
    )
    .all(needle) as Array<Parameters<typeof rowToEntity>[0]>;

  return rows
    .map((r) => rowToEntity(r))
    .filter((e): e is KnowledgeEntity => e !== null)
    .sort((a, b) => b.composite_score - a.composite_score);
}

/** P5.5 — stale entity with high open_count loses to fresher rival (decay on read). */
export function rankEntitiesForKey(key: string): KnowledgeEntity[] {
  return rankEntities(key);
}

export function clearKnowledgeGraph(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM knowledge_entity`);
}

/** P6 dashboard — most-launched native apps. */
export function listTopAppsForDashboard(
  limit = 6,
): Array<{ appId: string; openCount: number; score: number }> {
  ensureTable();
  const rows = getRippleDb()
    .prepare(
      `SELECT canonical_key, type, resolved_path, open_count, composite_score,
              last_opened_at, confirmed_at
       FROM knowledge_entity
       WHERE type IN ('app', 'app_role')
       ORDER BY open_count DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    canonical_key: string;
    type: string;
    resolved_path: string | null;
    open_count: number;
    composite_score: number;
    last_opened_at: string | null;
    confirmed_at: string | null;
  }>;

  return rows
    .map((r) => {
      const entity = rowToEntity(r);
      if (!entity) return null;
      return {
        appId: entity.path,
        openCount: entity.open_count ?? r.open_count,
        score: entity.composite_score,
      };
    })
    .filter((e): e is { appId: string; openCount: number; score: number } => e !== null);
}
