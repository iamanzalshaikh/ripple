import type { WorldModel } from "../types.js";
import type { ExecutionPlan, PlannerPartialResult } from "./planTypes.js";
import { buildExecutorPayload } from "./plannerExecutor.js";
import { runValidatedPlanExecution } from "./executionRequest.js";
import { logExecutionPlan } from "./planLogger.js";
import {
  compoundPartialTailQuestion,
  tryPlanUnresolvedClauses,
} from "./compoundUnresolvedPlanner.js";
import { phaseBExecuteEnabled } from "./phaseBConfig.js";
import type { CommandResultPayload } from "../../automation/types.js";
import type { ActionRunSummary } from "../../automation/types.js";

const TAIL_SETTLE_MS = 900;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type PartialExecuteInput = {
  partial: PlannerPartialResult;
  command: string;
  effectiveCommand: string;
  normalized: string;
  world: WorldModel;
  detail: string;
  getAccessToken?: () => Promise<string | null>;
  runPayload: (payload: CommandResultPayload) => Promise<ActionRunSummary | null>;
};

export type PartialExecuteOutcome =
  | {
      kind: "executed";
      resolvedOk: boolean;
      tailOk: boolean;
      tailPlanned: boolean;
      payload?: CommandResultPayload;
      execution?: ActionRunSummary | null;
      message: string;
    }
  | { kind: "clarify"; question: string; reason: string }
  | { kind: "failed"; message: string };

async function executePlanOnce(
  plan: ExecutionPlan,
  command: string,
  world: WorldModel,
  detail: string,
  getAccessToken: PartialExecuteInput["getAccessToken"],
  runPayload: PartialExecuteInput["runPayload"],
  stage: string,
): Promise<{
  ok: boolean;
  payload?: CommandResultPayload;
  execution?: ActionRunSummary | null;
  message?: string;
}> {
  logExecutionPlan(plan, stage);
  const built = buildExecutorPayload(plan, command, world);
  if (built.kind === "invalid") {
    const blocked = built.errors.find((e) => e.startsWith("permission_blocked:"));
    return {
      ok: false,
      message:
        blocked?.replace(/^permission_blocked:/, "") ?? built.errors.join(", "),
    };
  }
  if (built.kind === "clarify") {
    return { ok: false, message: built.question };
  }
  const execResult = await runValidatedPlanExecution({
    plan: built.plan,
    command,
    world,
    built,
    getAccessToken,
    runPayload,
  });
  const execution = execResult.actionSummary ?? null;
  const ok = execResult.ok && (execution?.allSucceeded ?? false);
  return {
    ok,
    payload: built.payload,
    execution,
    message: ok ? undefined : execResult.error ?? "execution_failed",
  };
}

/** Phase B — execute resolved compound steps, then tail when plannable. */
export async function executeCompoundPartialPlan(
  input: PartialExecuteInput,
): Promise<PartialExecuteOutcome> {
  if (!phaseBExecuteEnabled()) {
    return {
      kind: "clarify",
      question: input.partial.question,
      reason: input.partial.reason,
    };
  }

  const resolved = await executePlanOnce(
    input.partial.plan,
    input.effectiveCommand,
    input.world,
    input.detail,
    input.getAccessToken,
    input.runPayload,
    "phase-b-resolved",
  );

  if (!resolved.ok) {
    return {
      kind: "failed",
      message: resolved.message ?? "Could not complete the first step.",
    };
  }

  const tailPlan = tryPlanUnresolvedClauses(input.partial.unresolvedClauses, {
    rawCommand: input.command,
    normalized: input.normalized,
  });

  if (!tailPlan) {
    return {
      kind: "clarify",
      question: compoundPartialTailQuestion(input.partial.unresolvedClauses),
      reason: "compound_partial_tail",
    };
  }

  console.info(
    `[ripple-p85] phase-b tail plan tools=${tailPlan.steps.map((s) => s.tool).join(",")}`,
  );

  await sleep(TAIL_SETTLE_MS);

  const tail = await executePlanOnce(
    tailPlan,
    input.effectiveCommand,
    input.world,
    input.detail,
    input.getAccessToken,
    input.runPayload,
    "phase-b-tail",
  );

  if (!tail.ok) {
    return {
      kind: "clarify",
      question: compoundPartialTailQuestion(input.partial.unresolvedClauses),
      reason: "compound_partial_tail_failed",
    };
  }

  const tailSummary = input.partial.unresolvedClauses
    .map((c) => c.trim())
    .join(", ");

  return {
    kind: "executed",
    resolvedOk: true,
    tailOk: true,
    tailPlanned: true,
    payload: tail.payload ?? resolved.payload,
    execution: tail.execution ?? resolved.execution,
    message: `Done — completed all steps including ${tailSummary}.`,
  };
}
