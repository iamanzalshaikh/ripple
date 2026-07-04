import type { PlannerShadowRecord } from "./planTypes.js";

export type PlannerMetricsSnapshot = {
  total: number;
  execute: number;
  defer: number;
  clarify: number;
  l0Hits: number;
  gptHits: number;
  avgLatencyMs: number;
  fallbackPct: number;
};

const MAX_SAMPLES = 500;
const samples: PlannerShadowRecord[] = [];

export function recordPlannerMetric(record: PlannerShadowRecord): void {
  samples.push(record);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
}

export function getPlannerMetrics(): PlannerMetricsSnapshot {
  const total = samples.length;
  if (total === 0) {
    return {
      total: 0,
      execute: 0,
      defer: 0,
      clarify: 0,
      l0Hits: 0,
      gptHits: 0,
      avgLatencyMs: 0,
      fallbackPct: 0,
    };
  }

  let execute = 0;
  let defer = 0;
  let clarify = 0;
  let l0Hits = 0;
  let gptHits = 0;
  let latencySum = 0;

  for (const s of samples) {
    latencySum += s.latencyMs;
    if (s.resultKind === "execute") {
      execute += 1;
      if (s.source === "L0") l0Hits += 1;
      if (s.source === "GPT") gptHits += 1;
    } else if (s.resultKind === "clarify") {
      clarify += 1;
    } else {
      defer += 1;
    }
  }

  const fallbackPct = total > 0 ? Math.round(((gptHits + defer) / total) * 100) : 0;

  return {
    total,
    execute,
    defer,
    clarify,
    l0Hits,
    gptHits,
    avgLatencyMs: Math.round(latencySum / total),
    fallbackPct,
  };
}

export function resetPlannerMetrics(): void {
  samples.length = 0;
}

export function formatPlannerMetricsLine(): string {
  const m = getPlannerMetrics();
  return (
    `[ripple-p85] metrics total=${m.total} execute=${m.execute} defer=${m.defer} ` +
    `clarify=${m.clarify} l0=${m.l0Hits} gpt=${m.gptHits} ` +
    `avgMs=${m.avgLatencyMs} fallbackPct=${m.fallbackPct}`
  );
}
