import { basename } from "node:path";
import { getRippleDb } from "./rippleDb.js";
import { addAlias, getAlias, inferAliasType } from "../automation/desktop/aliasRegistry.js";
import { spokenNameFromPath } from "./lastCommandState.js";

const AUTO_ALIAS_THRESHOLD = 3;

function ensurePathOpensTable(): void {
  getRippleDb().exec(`
    CREATE TABLE IF NOT EXISTS path_opens (
      path TEXT PRIMARY KEY NOT NULL,
      open_count INTEGER NOT NULL DEFAULT 0,
      last_spoken TEXT,
      updated_at TEXT NOT NULL
    )
  `);
}

/** Track successful opens; auto-create alias after ${AUTO_ALIAS_THRESHOLD} opens. */
export function trackPathOpen(path: string, spokenCommand?: string): void {
  if (!path.trim()) return;
  ensurePathOpensTable();

  const db = getRippleDb();
  const now = new Date().toISOString();
  const spoken =
    spokenCommand?.trim().slice(0, 200) ??
    basename(path).replace(/\.[^.]+$/, "");

  const row = db
    .prepare(`SELECT open_count FROM path_opens WHERE path = ?`)
    .get(path) as { open_count: number } | undefined;

  const count = (row?.open_count ?? 0) + 1;
  db.prepare(
    `INSERT INTO path_opens (path, open_count, last_spoken, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       open_count = excluded.open_count,
       last_spoken = excluded.last_spoken,
       updated_at = excluded.updated_at`,
  ).run(path, count, spoken, now);

  if (count < AUTO_ALIAS_THRESHOLD) return;

  const suggested = spokenNameFromPath(path);
  if (!suggested || suggested.length < 2) return;
  if (getAlias(suggested)) return;

  try {
    addAlias(suggested, path, inferAliasType(path));
    console.info(
      `[ripple-desktop] Auto-alias created after ${count} opens: "${suggested}" → ${path}`,
    );
  } catch {
    /* alias name collision — skip */
  }
}
