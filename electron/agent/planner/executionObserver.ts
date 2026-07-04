import type { ActionRunSummary, CommandResultPayload } from "../../automation/types.js";
import type { ExecutionPlan } from "./planTypes.js";
import type { FailureClass, RecoveryOutcome } from "./recoveryEngine.js";

export type ExecutionObservation = {
  command: string;
  planSource: string;
  goal: string;
  tools: string[];
  intent?: string;
  succeeded: boolean;
  recovered: boolean;
  recoveryAttempts: number;
  failureClass?: FailureClass;
  actionCount: number;
  failedActions: string[];
  at: number;
};

const MAX_OBSERVATIONS = 100;
const observations: ExecutionObservation[] = [];

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** P9 prep — structured post-execution observation for observe/retry loop. */
export function observeP85Execution(input: {
  command: string;
  plan: ExecutionPlan;
  payload: CommandResultPayload;
  summary: ActionRunSummary | null;
  recovery?: RecoveryOutcome;
}): ExecutionObservation {
  const failed = (input.summary?.records ?? [])
    .filter((r) => r.status === "failed")
    .map((r) => r.type);

  const observation: ExecutionObservation = {
    command: input.command.slice(0, 200),
    planSource: input.plan.source,
    goal: input.plan.goal.slice(0, 200),
    tools: input.plan.steps.map((s) => s.tool),
    intent: input.payload.intent,
    succeeded: input.summary?.allSucceeded ?? false,
    recovered: input.recovery?.recovered ?? false,
    recoveryAttempts: input.recovery?.attempts ?? 0,
    failureClass: input.recovery?.failureClass,
    actionCount: input.summary?.records.length ?? 0,
    failedActions: failed,
    at: Date.now(),
  };

  observations.push(observation);
  if (observations.length > MAX_OBSERVATIONS) {
    observations.splice(0, observations.length - MAX_OBSERVATIONS);
  }

  console.info(
    `[ripple-p9] observe ok=${observation.succeeded} recovered=${observation.recovered} ` +
      `source=${observation.planSource} tools=${observation.tools.join(",")}`,
  );

  return observation;
}

export function getRecentExecutionObservations(limit = 20): ExecutionObservation[] {
  return observations.slice(-limit).reverse();
}

export function resetExecutionObservations(): void {
  observations.length = 0;
}

export function exportExecutionObservationsCsv(limit = 100): string {
  const rows = getRecentExecutionObservations(limit);
  const header =
    "at,command,plan_source,goal,tools,intent,succeeded,recovered,recovery_attempts,failure_class,action_count,failed_actions";
  const lines = rows.map((o) =>
    [
      new Date(o.at).toISOString(),
      csvEscape(o.command),
      o.planSource,
      csvEscape(o.goal),
      csvEscape(o.tools.join("|")),
      o.intent ?? "",
      o.succeeded ? "1" : "0",
      o.recovered ? "1" : "0",
      String(o.recoveryAttempts),
      o.failureClass ?? "",
      String(o.actionCount),
      csvEscape(o.failedActions.join("|")),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}
