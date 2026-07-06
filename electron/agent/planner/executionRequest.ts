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
  mergeExecutorSummaries,
  planEligibleForToolExecutor,
  runPlanViaToolExecutor,
  toolExecutorSummaryToActionRunSummary,
} from "./toolExecutorBridge.js";
import type { StepExecutionRecord, ToolExecutorSummary } from "./toolExecutor.js";
import { join } from "node:path";
import { resolveFolderPath } from "../../automation/desktop/openFolder.js";
import { submitSaveDialog } from "./executionSync.js";
import { dismissExtraNotepadInstances } from "../../focus/saveDialogMode.js";

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
): Promise<{
  actionSummary: ActionRunSummary | null;
  executorSummary: ToolExecutorSummary | null;
}> {
  if (via === "executor") {
    const execSummary = await runPlanViaToolExecutor(
      plan,
      input.command,
      input.world,
      input.userOverride,
    );
    return {
      executorSummary: execSummary,
      actionSummary: toolExecutorSummaryToActionRunSummary(
        plan,
        execSummary,
        payload.command_id,
      ),
    };
  }
  return {
    executorSummary: null,
    actionSummary: await input.runPayload(payload),
  };
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

  const firstRun = await executeViaRoute(input, activePlan, payload, via);
  let actionSummary = firstRun.actionSummary;
  let lastExecutorSummary = firstRun.executorSummary;

  let recovery: Awaited<ReturnType<typeof attemptP85Recovery>> | undefined;
  if (actionSummary && !actionSummary.allSucceeded) {
    recovery = await attemptP85Recovery({
      command: input.command,
      payload,
      initialSummary: actionSummary,
      isSaveStepIndex: (failedIndex) =>
        activePlan.steps[failedIndex]?.tool === "desktop.save_file",
      execute: async (retryPayload) => {
        const failed = actionSummary?.records.find((r) => r.status === "failed");
        if (
          failed &&
          activePlan.steps[failed.index]?.tool === "desktop.save_file"
        ) {
          console.warn(
            "[ripple-p85] blocked full-plan retry for desktop.save_file failure",
          );
          return actionSummary;
        }
        if (via === "executor" && planEligibleForToolExecutor(activePlan)) {
          const summary = await runPlanViaToolExecutor(
            activePlan,
            input.command,
            input.world,
            input.userOverride,
          );
          lastExecutorSummary = summary;
          const bridged = toolExecutorSummaryToActionRunSummary(
            activePlan,
            summary,
            retryPayload.command_id,
          );
          actionSummary = bridged;
          return bridged;
        }
        const rerun = await input.runPayload(retryPayload);
        if (rerun) actionSummary = rerun;
        return rerun;
      },
      executeFromStep: async (failedIndex) => {
        const step = activePlan.steps[failedIndex];
        if (step?.tool !== "desktop.save_file") {
          return null;
        }

        const filename =
          typeof step.args.filename === "string" ? step.args.filename.trim() : "";
        const folderKey =
          typeof step.args.folder === "string" && step.args.folder.trim()
            ? step.args.folder.trim()
            : "downloads";
        const fullPath = join(resolveFolderPath(folderKey), filename);

        let saveOk = false;
        let saveError: string | undefined;
        try {
          await submitSaveDialog(fullPath, { recoveryAttempt: true });
          saveOk = true;
        } catch (e: unknown) {
          saveError = e instanceof Error ? e.message : "save_file_failed";
        }

        const saveDetail = saveOk ? `Saved to ${fullPath}` : undefined;

        if (via === "executor" && planEligibleForToolExecutor(activePlan)) {
          const priorOk = (lastExecutorSummary?.records ?? []).filter(
            (r) => r.index < failedIndex && r.result.ok,
          );

          const retryRecord = {
            index: failedIndex,
            tool: step.tool,
            result: {
              ok: saveOk,
              error: saveError,
              output: saveDetail,
            },
          };

          const merged = mergeExecutorSummaries(
            lastExecutorSummary ?? { ok: false, records: priorOk, replanned: false },
            {
              ok: saveOk,
              records: [...priorOk, retryRecord],
              replanned: false,
            },
            failedIndex,
          );
          lastExecutorSummary = merged;
          console.info(
            `[ripple-p85] recovery save-fill-only index=${failedIndex} ok=${saveOk}`,
          );
          const bridged = toolExecutorSummaryToActionRunSummary(
            activePlan,
            merged,
            payload.command_id,
          );
          actionSummary = bridged;
          return bridged;
        }

        if (!actionSummary) return null;

        const records = actionSummary.records.map((r) =>
          r.index === failedIndex
            ? {
                ...r,
                status: saveOk ? ("executed" as const) : ("failed" as const),
                error: saveError,
                detail: saveDetail,
              }
            : r,
        );
        const patched: ActionRunSummary = {
          ...actionSummary,
          records,
          allSucceeded: records.every((r) => r.status === "executed"),
        };
        actionSummary = patched;
        console.info(
          `[ripple-p85] recovery save-fill-only index=${failedIndex} ok=${saveOk}`,
        );
        return patched;
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
