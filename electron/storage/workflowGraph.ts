import { existsSync, readFileSync } from "node:fs";
import { getWorkflowsFilePath } from "../config/ripplePaths.js";
import { getRippleDb } from "./rippleDb.js";
import type { WorkflowStepDef } from "../automation/desktop/userWorkflows.js";
import { normalizeRegistryKey } from "../automation/desktop/spokenName.js";

export type WorkflowGraphEntry = {
  name: string;
  version: number;
  steps: WorkflowStepDef[];
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveWorkflowOptions = {
  /** When true, archive current latest and save as next version. */
  replace?: boolean;
};

function normalizeName(name: string): string {
  return normalizeRegistryKey(name);
}

function ensureTable(): void {
  getRippleDb();
}

function rowToEntry(row: {
  name: string;
  workflow_version: number;
  steps_json: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}): WorkflowGraphEntry | null {
  try {
    const steps = JSON.parse(row.steps_json) as WorkflowStepDef[];
    if (!Array.isArray(steps)) return null;
    return {
      name: row.name,
      version: row.workflow_version,
      steps,
      runCount: row.run_count,
      lastRunAt: row.last_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

function latestVersionRow(name: string) {
  return getRippleDb()
    .prepare(
      `SELECT name, workflow_version, steps_json, run_count, last_run_at,
              created_at, updated_at
       FROM workflow_graph
       WHERE name = ?
       ORDER BY workflow_version DESC
       LIMIT 1`,
    )
    .get(normalizeName(name)) as
    | {
        name: string;
        workflow_version: number;
        steps_json: string;
        run_count: number;
        last_run_at: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

let legacyJsonMigrated = false;
let migratingFromJson = false;

/** Test-only — prevent JSON re-import after explicit clear. */
export function resetWorkflowGraphForTests(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM workflow_graph`);
  legacyJsonMigrated = true;
}

/** One-time migration from legacy workflows.json → SQLite v1. */
export function migrateWorkflowsJsonIfNeeded(): void {
  if (legacyJsonMigrated || migratingFromJson) return;
  ensureTable();
  const db = getRippleDb();
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM workflow_graph`)
    .get() as { n: number };
  if (count.n > 0) {
    legacyJsonMigrated = true;
    return;
  }

  const file = getWorkflowsFilePath();
  if (!existsSync(file)) {
    legacyJsonMigrated = true;
    return;
  }

  migratingFromJson = true;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      workflows?: Record<string, { name: string; steps: WorkflowStepDef[] }>;
    };
    const workflows = parsed?.workflows ?? {};
    for (const wf of Object.values(workflows)) {
      insertWorkflowVersion(wf.name, wf.steps, 1);
    }
    if (Object.keys(workflows).length > 0) {
      console.info(
        `[ripple-desktop] Migrated ${Object.keys(workflows).length} workflow(s) to workflow_graph`,
      );
    }
  } catch {
    /* ignore corrupt legacy file */
  } finally {
    migratingFromJson = false;
    legacyJsonMigrated = true;
  }
}

function insertWorkflowVersion(
  name: string,
  steps: WorkflowStepDef[],
  version: number,
): void {
  const key = normalizeName(name);
  const now = new Date().toISOString();
  const stepsJson = JSON.stringify(steps);
  getRippleDb()
    .prepare(
      `INSERT OR IGNORE INTO workflow_graph
        (name, workflow_version, steps_json, run_count, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    )
    .run(key, version, stepsJson, now, now);
}

export function getWorkflowGraph(
  name: string,
  version?: number,
): WorkflowGraphEntry | null {
  ensureTable();
  migrateWorkflowsJsonIfNeeded();

  const key = normalizeName(name);
  if (version != null) {
    const row = getRippleDb()
      .prepare(
        `SELECT name, workflow_version, steps_json, run_count, last_run_at,
                created_at, updated_at
         FROM workflow_graph
         WHERE name = ? AND workflow_version = ?`,
      )
      .get(key, version) as Parameters<typeof rowToEntry>[0] | undefined;
    return row ? rowToEntry(row) : null;
  }

  const latest = latestVersionRow(key);
  return latest ? rowToEntry(latest) : null;
}

export function listWorkflowGraph(): WorkflowGraphEntry[] {
  ensureTable();
  migrateWorkflowsJsonIfNeeded();

  const rows = getRippleDb()
    .prepare(
      `SELECT w.name, w.workflow_version, w.steps_json, w.run_count, w.last_run_at,
              w.created_at, w.updated_at
       FROM workflow_graph w
       INNER JOIN (
         SELECT name, MAX(workflow_version) AS max_v
         FROM workflow_graph
         GROUP BY name
       ) latest ON w.name = latest.name AND w.workflow_version = latest.max_v
       ORDER BY w.name ASC`,
    )
    .all() as Array<Parameters<typeof rowToEntry>[0]>;

  return rows
    .map((r) => rowToEntry(r))
    .filter((e): e is WorkflowGraphEntry => e !== null);
}

export function saveWorkflowGraph(
  name: string,
  steps: WorkflowStepDef[],
  options?: SaveWorkflowOptions,
): WorkflowGraphEntry {
  ensureTable();
  migrateWorkflowsJsonIfNeeded();

  const key = normalizeName(name);
  const now = new Date().toISOString();
  const stepsJson = JSON.stringify(steps);
  const latest = latestVersionRow(key);

  if (latest && !options?.replace) {
    const sameSteps = latest.steps_json === stepsJson;
    if (sameSteps) {
      const entry = rowToEntry(latest)!;
      return entry;
    }
    throw new Error(
      `Workflow "${key}" already exists (v${latest.workflow_version}) — say "Replace ${key}" to update or pick a new name`,
    );
  }

  const nextVersion = latest ? latest.workflow_version + 1 : 1;
  const db = getRippleDb();
  db.prepare(
    `INSERT INTO workflow_graph
      (name, workflow_version, steps_json, run_count, last_run_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, NULL, ?, ?)`,
  ).run(key, nextVersion, stepsJson, now, now);

  console.info(
    `[ripple-desktop] ${latest ? "Replaced" : "Created"} workflow "${key}" v${nextVersion}`,
  );

  return {
    name: key,
    version: nextVersion,
    steps,
    runCount: 0,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function removeWorkflowGraph(name: string): boolean {
  ensureTable();
  const key = normalizeName(name);
  const result = getRippleDb()
    .prepare(`DELETE FROM workflow_graph WHERE name = ?`)
    .run(key);
  return result.changes > 0;
}

export function recordWorkflowRun(name: string, version?: number): void {
  ensureTable();
  const key = normalizeName(name);
  const ver =
    version ??
    latestVersionRow(key)?.workflow_version;
  if (!ver) return;

  const now = new Date().toISOString();
  getRippleDb()
    .prepare(
      `UPDATE workflow_graph
       SET run_count = run_count + 1, last_run_at = ?, updated_at = ?
       WHERE name = ? AND workflow_version = ?`,
    )
    .run(now, now, key, ver);
}

export function clearWorkflowGraph(): void {
  ensureTable();
  getRippleDb().exec(`DELETE FROM workflow_graph`);
}

/** P6 dashboard — most-run workflows (latest version per name). */
export function listTopWorkflowsForDashboard(
  limit = 6,
): Array<{ name: string; version: number; runCount: number }> {
  ensureTable();
  migrateWorkflowsJsonIfNeeded();

  const rows = getRippleDb()
    .prepare(
      `SELECT w.name, w.workflow_version, w.run_count
       FROM workflow_graph w
       INNER JOIN (
         SELECT name, MAX(workflow_version) AS max_v
         FROM workflow_graph GROUP BY name
       ) latest ON w.name = latest.name AND w.workflow_version = latest.max_v
       ORDER BY w.run_count DESC, w.name ASC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    name: string;
    workflow_version: number;
    run_count: number;
  }>;

  return rows.map((r) => ({
    name: r.name,
    version: r.workflow_version,
    runCount: r.run_count,
  }));
}
