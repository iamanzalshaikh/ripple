import {
  getRecentTelemetry,
  queryTelemetryFromDb,
  queryTelemetrySince,
  type CommandTelemetryEvent,
} from "./commandTelemetry.js";
import { evaluateCiGate, type CiGateResult } from "./ciGateStatus.js";
import { listTopAppsForDashboard } from "../storage/knowledgeGraph.js";
import { listTopWorkflowsForDashboard } from "../storage/workflowGraph.js";

export type ObservabilitySummary = {
  total: number;
  byOutcome: Record<string, number>;
  byPlannerSource: Record<string, number>;
  recentFailures: CommandTelemetryEvent[];
  successRatePercent: number;
  rolling7DaySuccessRate: number;
  topFailedCommands: Array<{ command: string; count: number }>;
  topClarifications: Array<{ command: string; count: number }>;
  topSearchMisses: Array<{ command: string; count: number }>;
  plannerMix: { offline: number; gpt: number; fast: number; graph: number };
  blockedPermissionCount: number;
  topWorkflows: Array<{ name: string; version: number; runCount: number }>;
  topApps: Array<{ appId: string; openCount: number; score: number }>;
  avgLatencyMs: number;
  ciGate?: CiGateResult;
};

export function buildCiGateSummary(): CiGateResult {
  return evaluateCiGate();
}

function loadEvents(limit = 500): CommandTelemetryEvent[] {
  const fromDb = queryTelemetryFromDb(limit);
  return fromDb.length > 0 ? fromDb : getRecentTelemetry(limit);
}

function topBy(
  events: CommandTelemetryEvent[],
  filter: (e: CommandTelemetryEvent) => boolean,
  limit = 8,
): Array<{ command: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (!filter(e)) continue;
    const key = e.command.slice(0, 120);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function successRate(events: CommandTelemetryEvent[]): number {
  const withOutcome = events.filter((e) => e.outcome);
  if (withOutcome.length === 0) return 0;
  const successes = withOutcome.filter((e) => e.outcome === "success").length;
  return Math.round((successes / withOutcome.length) * 100);
}

function avgLatency(events: CommandTelemetryEvent[]): number {
  const withLatency = events.filter((e) => e.latency_ms != null && e.latency_ms > 0);
  if (withLatency.length === 0) return 0;
  const sum = withLatency.reduce((a, e) => a + (e.latency_ms ?? 0), 0);
  return Math.round(sum / withLatency.length);
}

export function buildObservabilitySummary(): ObservabilitySummary {
  const events = loadEvents(500);
  const weekEvents = queryTelemetrySince(7, 2000);
  const byOutcome: Record<string, number> = {};
  const byPlannerSource: Record<string, number> = {};
  const plannerMix = { offline: 0, gpt: 0, fast: 0, graph: 0 };
  let blockedPermissionCount = 0;

  for (const e of events) {
    const outcome = e.outcome ?? "unknown";
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
    if (outcome === "blocked" || e.permission === "blocked") {
      blockedPermissionCount++;
    }
    if (e.planner_source) {
      byPlannerSource[e.planner_source] =
        (byPlannerSource[e.planner_source] ?? 0) + 1;
      if (e.planner_source === "offline") plannerMix.offline++;
      else if (e.planner_source === "gpt") plannerMix.gpt++;
      else if (e.planner_source === "fast") plannerMix.fast++;
      else if (e.planner_source === "graph") plannerMix.graph++;
    }
  }

  const recentFailures = events.filter(
    (e) =>
      e.outcome === "error" ||
      e.outcome === "blocked" ||
      e.outcome === "rephrase" ||
      e.outcome === "not_found",
  );

  return {
    total: events.length,
    byOutcome,
    byPlannerSource,
    recentFailures: recentFailures.slice(0, 12),
    successRatePercent: successRate(events),
    rolling7DaySuccessRate: successRate(weekEvents.length > 0 ? weekEvents : events),
    topFailedCommands: topBy(
      events,
      (e) =>
        e.outcome === "error" ||
        e.outcome === "blocked" ||
        e.outcome === "rephrase",
    ),
    topClarifications: topBy(
      events,
      (e) => e.outcome === "clarify" || e.detail === "clarify_dismissed",
    ),
    topSearchMisses: topBy(
      events,
      (e) =>
        e.outcome === "not_found" ||
        e.detail?.includes("search") === true ||
        e.detail === "no_auth_token",
    ),
    plannerMix,
    blockedPermissionCount,
    topWorkflows: listTopWorkflowsForDashboard(6),
    topApps: listTopAppsForDashboard(6),
    avgLatencyMs: avgLatency(events),
  };
}

export function exportTelemetryCsv(limit = 500): string {
  const events = loadEvents(limit);
  const header =
    "created_at,command,outcome,planner_source,intent,confidence,permission,latency_ms,detail";
  const rows = events.map((e) => {
    const cols = [
      new Date(e.at).toISOString(),
      csvEscape(e.command),
      e.outcome ?? "",
      e.planner_source ?? "",
      e.intent ?? "",
      e.confidence != null ? String(e.confidence) : "",
      e.permission ?? "",
      e.latency_ms != null ? String(e.latency_ms) : "",
      csvEscape(e.detail ?? ""),
    ];
    return cols.join(",");
  });
  return [header, ...rows].join("\n");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
