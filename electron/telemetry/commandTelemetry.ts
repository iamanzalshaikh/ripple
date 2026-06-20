import { getRippleDb } from "../storage/rippleDb.js";

export type PlannerSource = "fast" | "offline" | "graph" | "gpt" | "unknown";

export type CommandOutcome =
  | "success"
  | "clarify"
  | "rephrase"
  | "not_found"
  | "blocked"
  | "cancel"
  | "undo"
  | "error";

export type CommandTelemetryEvent = {
  command: string;
  planner_source?: PlannerSource;
  outcome?: CommandOutcome;
  intent?: string;
  confidence?: number;
  permission?: string;
  latency_ms?: number;
  detail?: string;
  error_code?: string;
  at: number;
};

const buffer: CommandTelemetryEvent[] = [];
const MAX_BUFFER = 500;

function persistEvent(event: CommandTelemetryEvent): void {
  try {
    getRippleDb()
      .prepare(
        `INSERT INTO command_telemetry
          (command, planner_source, outcome, intent, confidence, latency_ms, detail, permission, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.command.slice(0, 500),
        event.planner_source ?? null,
        event.outcome ?? null,
        event.intent ?? event.error_code ?? null,
        event.confidence ?? null,
        event.latency_ms ?? null,
        event.detail ?? event.error_code ?? null,
        event.permission ?? null,
        new Date(event.at).toISOString(),
      );
  } catch {
    /* telemetry must not break commands */
  }
}

export function recordCommandEvent(
  partial: Omit<CommandTelemetryEvent, "at">,
): void {
  const event: CommandTelemetryEvent = { ...partial, at: Date.now() };
  buffer.push(event);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  persistEvent(event);
  console.info(
    `[ripple-telemetry] ${event.outcome ?? "event"} source=${event.planner_source ?? "-"} intent=${event.intent ?? "-"}`,
  );
}

export function recordPlannerSource(source: PlannerSource, command: string): void {
  recordCommandEvent({ command, planner_source: source });
}

export function getRecentTelemetry(limit = 50): CommandTelemetryEvent[] {
  return buffer.slice(-limit);
}

export function clearTelemetryBuffer(): void {
  buffer.length = 0;
}

function rowToEvent(r: {
  command: string;
  planner_source: string | null;
  outcome: string | null;
  intent: string | null;
  confidence: number | null;
  latency_ms: number | null;
  detail: string | null;
  permission: string | null;
  created_at: string;
}): CommandTelemetryEvent {
  return {
    command: r.command,
    planner_source: (r.planner_source as PlannerSource) ?? undefined,
    outcome: (r.outcome as CommandOutcome) ?? undefined,
    intent: r.intent ?? undefined,
    confidence: r.confidence ?? undefined,
    permission: r.permission ?? undefined,
    latency_ms: r.latency_ms ?? undefined,
    detail: r.detail ?? undefined,
    at: Date.parse(r.created_at) || Date.now(),
  };
}

export function queryTelemetryFromDb(limit = 100): CommandTelemetryEvent[] {
  try {
    const rows = getRippleDb()
      .prepare(
        `SELECT command, planner_source, outcome, intent, confidence, latency_ms, detail, permission, created_at
         FROM command_telemetry ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<Parameters<typeof rowToEvent>[0]>;

    return rows.map(rowToEvent);
  } catch {
    return [];
  }
}

/** P6 — events since N days ago (for rolling 7-day metrics). */
export function queryTelemetrySince(days: number, limit = 2000): CommandTelemetryEvent[] {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = getRippleDb()
      .prepare(
        `SELECT command, planner_source, outcome, intent, confidence, latency_ms, detail, permission, created_at
         FROM command_telemetry
         WHERE created_at >= ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(since, limit) as Array<Parameters<typeof rowToEvent>[0]>;

    return rows.map(rowToEvent);
  } catch {
    return [];
  }
}

export function clearTelemetryDb(): void {
  try {
    getRippleDb().exec(`DELETE FROM command_telemetry`);
    clearTelemetryBuffer();
  } catch {
    /* ignore */
  }
}
