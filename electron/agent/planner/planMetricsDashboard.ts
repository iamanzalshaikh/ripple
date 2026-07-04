import { getPlannerMetrics, type PlannerMetricsSnapshot } from "./planMetrics.js";
import { queryPlannerShadowFromDb } from "./planPersistence.js";
import { getRouterParitySnapshot, type RouterParitySnapshot } from "./routerParity.js";
import { planCacheSize } from "./planCache.js";

export type PlannerDashboardSummary = {
  session: PlannerMetricsSnapshot;
  persisted: {
    total: number;
    execute: number;
    defer: number;
    clarify: number;
    l0Hits: number;
    gptHits: number;
    cacheHits: number;
    avgLatencyMs: number;
    l0HitRatePct: number;
    gptFallbackPct: number;
    topDeferReasons: Array<{ reason: string; count: number }>;
    topTools: Array<{ tool: string; count: number }>;
  };
  routerParity: RouterParitySnapshot;
  cacheEntries: number;
};

function aggregateShadowRows(
  rows: Awaited<ReturnType<typeof queryPlannerShadowFromDb>>,
): PlannerDashboardSummary["persisted"] {
  const empty = {
    total: 0,
    execute: 0,
    defer: 0,
    clarify: 0,
    l0Hits: 0,
    gptHits: 0,
    cacheHits: 0,
    avgLatencyMs: 0,
    l0HitRatePct: 0,
    gptFallbackPct: 0,
    topDeferReasons: [] as Array<{ reason: string; count: number }>,
    topTools: [] as Array<{ tool: string; count: number }>,
  };
  if (!rows.length) return empty;

  let latencySum = 0;
  const deferReasons = new Map<string, number>();
  const tools = new Map<string, number>();

  for (const row of rows) {
    latencySum += row.latencyMs;
    if (row.resultKind === "execute") {
      empty.execute += 1;
      if (row.source === "L0") empty.l0Hits += 1;
      if (row.source === "GPT") empty.gptHits += 1;
      if (row.source === "cache") empty.cacheHits += 1;
      if (row.tools) {
        for (const t of row.tools.split(",")) {
          const tool = t.trim();
          if (tool) tools.set(tool, (tools.get(tool) ?? 0) + 1);
        }
      }
    } else if (row.resultKind === "clarify") {
      empty.clarify += 1;
    } else {
      empty.defer += 1;
      const reason = row.reason?.split(":")[0] ?? "unknown";
      deferReasons.set(reason, (deferReasons.get(reason) ?? 0) + 1);
    }
  }

  empty.total = rows.length;
  empty.avgLatencyMs = Math.round(latencySum / rows.length);
  empty.l0HitRatePct =
    empty.execute > 0 ? Math.round((empty.l0Hits / empty.execute) * 100) : 0;
  empty.gptFallbackPct =
    empty.total > 0
      ? Math.round(((empty.gptHits + empty.defer) / empty.total) * 100)
      : 0;
  empty.topDeferReasons = [...deferReasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  empty.topTools = [...tools.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return empty;
}

/** P8.5 metrics dashboard — session + SQLite shadow + router parity. */
export function buildPlannerDashboardSummary(
  persistedLimit = 500,
): PlannerDashboardSummary {
  const rows = queryPlannerShadowFromDb(persistedLimit);
  return {
    session: getPlannerMetrics(),
    persisted: aggregateShadowRows(rows),
    routerParity: getRouterParitySnapshot(),
    cacheEntries: planCacheSize(),
  };
}

export function formatPlannerDashboardLine(): string {
  const d = buildPlannerDashboardSummary(200);
  const p = d.persisted;
  const r = d.routerParity;
  return (
    `[ripple-p85] dashboard session=${d.session.total} persisted=${p.total} ` +
    `l0Rate=${p.l0HitRatePct}% gptFallback=${p.gptFallbackPct}% ` +
    `avgMs=${p.avgLatencyMs} cache=${d.cacheEntries} ` +
    `mismatch=${r.mismatchTotal} deprecReady=${r.readyForDeprecation}`
  );
}
