import type { ActionRunSummary, CommandResultPayload } from "../../automation/types.js";
import type { WorldModel } from "../types.js";
import { buildWorldModel } from "../worldModel.js";
import type { ExecutionPlan } from "./planTypes.js";
import type { PlannerExecutorResult } from "./plannerExecutor.js";
import { buildExecutorPayload } from "./plannerExecutor.js";
import { runPlannerPipelineAsync } from "./plannerPipeline.js";
import { attemptP85Recovery } from "./recoveryEngine.js";
import { logExecutionPlan } from "./planLogger.js";
import {
  isToolExecutorRouteEnabled,
  planEligibleForToolExecutor,
  runPlanViaToolExecutor,
  toolExecutorSummaryToActionRunSummary,
} from "./toolExecutorBridge.js";
import type { StepExecutionRecord } from "./toolExecutor.js";

/** Public planner → executor boundary (§4b.3). */
export interface ExecutionRequest {
  plan: ExecutionPlan;
  command: string;
  world: WorldModel;
  userOverride?: boolean;
}

export type ExecutionFailureKind =
  | "invalid_plan"
  | "permission_blocked"
  | "clarify"
  | "executor_error"
  | "payload_build_failed";

export interface ExecutionResult {
  ok: boolean;
  records: StepExecutionRecord[];
  cancelledByUser?: boolean;
  failure?: ExecutionFailureKind;
  error?: string;
  via?: "executor" | "payload";
  payload?: CommandResultPayload;
  actionSummary?: ActionRunSummary | null;
  recovery?: Awaited<ReturnType<typeof attemptP85Recovery>>;
}

export type PlanExecutionInput = {
  plan: ExecutionPlan;
  command: string;
  world: WorldModel;
  built: Extract<PlannerExecutorResult, { kind: "payload" | "executor" }>;
  userOverride?: boolean;
  getAccessToken?: () => Promise<string | null>;
  runPayload: (
    payload: CommandResultPayload,
  ) => Promise<ActionRunSummary | null>;
};

function recordsFromSummary(summary: ActionRunSummary | null): StepExecutionRecord[] {
  if (!summary) return [];
  return summary.records.map((r) => ({
    index: r.index,
    tool: r.type,
    result: {
      ok: r.status === "executed",
      error: r.error,
      output: r.detail,
    },
  }));
}

async function executeViaRoute(
  input: PlanExecutionInput,
  plan: ExecutionPlan,
  payload: CommandResultPayload,
  via: "executor" | "payload",
): Promise<ActionRunSummary | null> {
  if (via === "executor") {
    const execSummary = await runPlanViaToolExecutor(
      plan,
      input.command,
      input.world,
      input.userOverride,
    );
    return toolExecutorSummaryToActionRunSummary(
      plan,
      execSummary,
      payload.command_id,
    );
  }
  return input.runPayload(payload);
}

function routeForPlan(
  plan: ExecutionPlan,
  builtKind: "payload" | "executor",
): "executor" | "payload" {
  if (builtKind === "executor") return "executor";
  if (isToolExecutorRouteEnabled() && planEligibleForToolExecutor(plan)) {
    return "executor";
  }
  return "payload";
}

/**
 * Run a validated plan through Tool Executor (preferred) or legacy payload actions.
 * Includes bounded recovery with executor-aware retry/replan.
 */
export async function runValidatedPlanExecution(
  input: PlanExecutionInput,
): Promise<ExecutionResult> {
  const payload = input.built.payload;
  let activePlan = input.plan;
  let via = routeForPlan(input.plan, input.built.kind);

  logExecutionPlan(activePlan, "executor-in");

  let actionSummary = await executeViaRoute(
    input,
    activePlan,
    payload,
    via,
  );

  let recovery: Awaited<ReturnType<typeof attemptP85Recovery>> | undefined;
  if (actionSummary && !actionSummary.allSucceeded) {
    recovery = await attemptP85Recovery({
      command: input.command,
      payload,
      initialSummary: actionSummary,
      execute: async (retryPayload) => {
        if (via === "executor" && planEligibleForToolExecutor(activePlan)) {
          const summary = await runPlanViaToolExecutor(
            activePlan,
            input.command,
            input.world,
            input.userOverride,
          );
          return toolExecutorSummaryToActionRunSummary(
            activePlan,
            summary,
            retryPayload.command_id,
          );
        }
        return input.runPayload(retryPayload);
      },
      replan: input.getAccessToken
        ? async () => {
            const world2 = await buildWorldModel();
            const pipeline2 = await runPlannerPipelineAsync({
              command: input.command,
              world: world2,
              getAccessToken: input.getAccessToken!,
            });
            if (pipeline2.kind !== "execute") return null;
            const built2 = buildExecutorPayload(
              pipeline2.plan,
              input.command,
              world2,
            );
            if (built2.kind === "invalid" || built2.kind === "clarify") {
              return null;
            }
            activePlan = built2.plan;
            via = routeForPlan(activePlan, built2.kind);
            return built2.payload;
          }
        : undefined,
    });
    actionSummary = recovery.summary ?? actionSummary;
  }

  const ok = actionSummary?.allSucceeded ?? false;

  return {
    ok,
    records: recordsFromSummary(actionSummary),
    via,
    payload,
    actionSummary,
    recovery,
    failure: ok ? undefined : "executor_error",
    error: ok
      ? undefined
      : actionSummary?.records.find((r) => r.status === "failed")?.error,
  };
}

/** High-level entry: validate + execute (orchestrator may call buildExecutorPayload first). */
export async function runExecution(
  request: ExecutionRequest & {
    built: PlannerExecutorResult;
    runPayload: PlanExecutionInput["runPayload"];
    getAccessToken?: () => Promise<string | null>;
  },
): Promise<ExecutionResult> {
  const { built } = request;
  if (built.kind === "invalid") {
    const blocked = built.errors.find((e) =>
      e.startsWith("permission_blocked:"),
    );
    return {
      ok: false,
      records: [],
      failure: blocked ? "permission_blocked" : "invalid_plan",
      error:
        blocked?.replace(/^permission_blocked:/, "") ?? built.errors.join(","),
    };
  }
  if (built.kind === "clarify") {
    return {
      ok: false,
      records: [],
      failure: "clarify",
      error: built.question,
    };
  }

  return runValidatedPlanExecution({
    plan: built.plan,
    command: request.command,
    world: request.world,
    built,
    userOverride: request.userOverride,
    getAccessToken: request.getAccessToken,
    runPayload: request.runPayload,
  });
}
