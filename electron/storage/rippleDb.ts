import { DatabaseSync } from "node:sqlite";
import { getRippleDbPath } from "../config/ripplePaths.js";

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS desktop_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  intent TEXT,
  result TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_desktop_history_created
  ON desktop_history(created_at DESC);
`;

export function initRippleDb(): void {
  if (db) return;

  const path = getRippleDbPath();
  db = new DatabaseSync(path);
  db.exec(SCHEMA);
  console.info(`[ripple-desktop] Local DB ready → ${path}`);
}

export function getRippleDb(): DatabaseSync {
  if (!db) {
    initRippleDb();
  }
  return db!;
}

export function closeRippleDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
