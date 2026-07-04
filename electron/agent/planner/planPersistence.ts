import { getRippleDb } from "../../storage/rippleDb.js";
import type { PlannerShadowRecord } from "./planTypes.js";

let tableReady = false;

function ensurePlannerShadowTable(): void {
  if (tableReady) return;
  try {
    getRippleDb().exec(`
      CREATE TABLE IF NOT EXISTS planner_shadow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_utterance TEXT NOT NULL,
        normalized_utterance TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        source TEXT,
        goal TEXT,
        tools TEXT,
        confidence REAL,
        validation_errors TEXT,
        reason TEXT,
        latency_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_planner_shadow_created
        ON planner_shadow(created_at DESC);
    `);
    tableReady = true;
  } catch {
    /* persistence must not break planning */
  }
}

/** P8.5 — persist shadow records for threshold tuning and P9 training data. */
export function persistPlannerShadow(record: PlannerShadowRecord): void {
  if (process.env.RIPPLE_P85_PERSIST === "0") return;
  try {
    ensurePlannerShadowTable();
    getRippleDb()
      .prepare(
        `INSERT INTO planner_shadow
          (raw_utterance, normalized_utterance, result_kind, source, goal,
           tools, confidence, validation_errors, reason, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.rawUtterance.slice(0, 500),
        record.normalizedUtterance.slice(0, 500),
        record.resultKind,
        record.source ?? null,
        record.goal?.slice(0, 200) ?? null,
        record.tools?.join(",") ?? null,
        record.confidence ?? null,
        record.validationErrors?.join(";") ?? null,
        record.reason ?? null,
        record.latencyMs,
        new Date().toISOString(),
      );
  } catch {
    /* ignore */
  }
}

export type PlannerShadowRow = {
  rawUtterance: string;
  normalizedUtterance: string;
  resultKind: string;
  source?: string;
  goal?: string;
  tools?: string;
  confidence?: number;
  validationErrors?: string;
  reason?: string;
  latencyMs: number;
  createdAt: string;
};

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Export persisted planner_shadow rows for offline tuning. */
export function exportPlannerShadowCsv(limit = 500): string {
  const rows = queryPlannerShadowFromDb(limit);
  const header =
    "created_at,raw_utterance,normalized_utterance,result_kind,source,goal,tools,confidence,validation_errors,reason,latency_ms";
  const lines = rows.map((r) =>
    [
      r.createdAt,
      csvEscape(r.rawUtterance),
      csvEscape(r.normalizedUtterance),
      r.resultKind,
      r.source ?? "",
      csvEscape(r.goal ?? ""),
      csvEscape(r.tools ?? ""),
      r.confidence != null ? String(r.confidence) : "",
      csvEscape(r.validationErrors ?? ""),
      csvEscape(r.reason ?? ""),
      String(r.latencyMs),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

export function queryPlannerShadowFromDb(limit = 500): PlannerShadowRow[] {
  try {
    ensurePlannerShadowTable();
    const rows = getRippleDb()
      .prepare(
        `SELECT raw_utterance, normalized_utterance, result_kind, source, goal,
                tools, confidence, validation_errors, reason, latency_ms, created_at
         FROM planner_shadow ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
        raw_utterance: string;
        normalized_utterance: string;
        result_kind: string;
        source: string | null;
        goal: string | null;
        tools: string | null;
        confidence: number | null;
        validation_errors: string | null;
        reason: string | null;
        latency_ms: number;
        created_at: string;
      }>;

    return rows.map((r) => ({
      rawUtterance: r.raw_utterance,
      normalizedUtterance: r.normalized_utterance,
      resultKind: r.result_kind,
      source: r.source ?? undefined,
      goal: r.goal ?? undefined,
      tools: r.tools ?? undefined,
      confidence: r.confidence ?? undefined,
      validationErrors: r.validation_errors ?? undefined,
      reason: r.reason ?? undefined,
      latencyMs: r.latency_ms,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
