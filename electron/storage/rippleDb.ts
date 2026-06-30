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

CREATE TABLE IF NOT EXISTS file_index (
  path TEXT PRIMARY KEY NOT NULL,
  filename TEXT NOT NULL,
  extension TEXT,
  is_directory INTEGER NOT NULL DEFAULT 0,
  root_folder TEXT NOT NULL,
  modified_at INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_index_filename ON file_index(filename);
CREATE INDEX IF NOT EXISTS idx_file_index_modified ON file_index(modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_index_extension ON file_index(extension);
CREATE INDEX IF NOT EXISTS idx_file_index_root ON file_index(root_folder);
`;

function migrateRippleSchema(database: DatabaseSync): void {
  const historyCols = database
    .prepare(`PRAGMA table_info(desktop_history)`)
    .all() as { name: string }[];

  const names = new Set(historyCols.map((c) => c.name));
  if (!names.has("resolved_path")) {
    database.exec(`ALTER TABLE desktop_history ADD COLUMN resolved_path TEXT`);
  }
  if (!names.has("entities_json")) {
    database.exec(`ALTER TABLE desktop_history ADD COLUMN entities_json TEXT`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS path_opens (
      path TEXT PRIMARY KEY NOT NULL,
      open_count INTEGER NOT NULL DEFAULT 0,
      last_spoken TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entity (
      canonical_key TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      resolved_path TEXT,
      composite_score REAL NOT NULL DEFAULT 0.5,
      open_count INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      confirmed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS capability_cache (
      phrase_key TEXT PRIMARY KEY NOT NULL,
      phrase TEXT NOT NULL,
      entity_path TEXT NOT NULL,
      confidence REAL NOT NULL,
      resolved_at TEXT NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS undo_stack (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  const entityCols = database
    .prepare(`PRAGMA table_info(knowledge_entity)`)
    .all() as { name: string }[];
  const entityNames = new Set(entityCols.map((c) => c.name));
  if (entityNames.size > 0 && !entityNames.has("confirmed_at")) {
    database.exec(`ALTER TABLE knowledge_entity ADD COLUMN confirmed_at TEXT`);
  }

  const telemetryCols = database
    .prepare(`PRAGMA table_info(command_telemetry)`)
    .all() as { name: string }[];
  const telemetryNames = new Set(telemetryCols.map((c) => c.name));
  if (telemetryNames.size > 0 && !telemetryNames.has("permission")) {
    database.exec(`ALTER TABLE command_telemetry ADD COLUMN permission TEXT`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS command_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      planner_source TEXT,
      outcome TEXT,
      intent TEXT,
      confidence REAL,
      latency_ms INTEGER,
      detail TEXT,
      created_at TEXT NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_turn (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      intent TEXT,
      resolved_path TEXT,
      entities_json TEXT,
      outcome TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS workflow_graph (
      name TEXT NOT NULL,
      workflow_version INTEGER NOT NULL DEFAULT 1,
      steps_json TEXT NOT NULL,
      run_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (name, workflow_version)
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_workflow_graph_name
      ON workflow_graph(name)
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT,
      app_id TEXT,
      contact TEXT,
      command TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_log_path ON activity_log(path)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_log_contact ON activity_log(contact)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC)
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS semantic_index (
      path TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      tokens TEXT NOT NULL,
      snippet TEXT,
      mtime INTEGER,
      indexed_at TEXT NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS life_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      topic TEXT NOT NULL,
      event_at TEXT NOT NULL,
      end_at TEXT,
      tags TEXT,
      created_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_life_events_topic ON life_events(topic)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_life_events_event_at ON life_events(event_at DESC)
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS semantic_embeddings (
      path TEXT PRIMARY KEY NOT NULL,
      dims INTEGER NOT NULL,
      embedding TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS semantic_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_key TEXT NOT NULL UNIQUE,
      app_id TEXT,
      contact TEXT,
      summary TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_semantic_refs_contact ON semantic_refs(contact)
  `);
}

export function initRippleDb(): void {
  if (db) return;

  const path = getRippleDbPath();
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(SCHEMA);
  migrateRippleSchema(db);
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
