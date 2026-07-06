import type { ExecutionPlan } from "./planTypes.js";
import type { WorldModel } from "../types.js";
import { executeToolForExecutor, getRegisteredTool } from "./toolRegistry.js";
import {
  type CapabilitySnapshot,
  type ExecutionContext,
  type ResolvedEntities,
  type ToolResult,
} from "./toolTypes.js";
import { bindStepArgs } from "./entityResolver.js";
import {
  createExecutionContext,
  refreshExecutionContext,
} from "./executionContext.js";
import {
  checkRateLimitForTool,
  confirmStepIfNeeded,
  permissionPass1ForStep,
  permissionPass2ForStep,
  pushUndoBeforeMutate,
  recordRateLimitUseForTool,
} from "./toolExecutorSafety.js";
import { observeToolStep } from "./stepObserver.js";
import {
  syncCompoundStepBoundary,
} from "./executionSync.js";
import {
  PLANNER_MEMORY_RECORD_MIN_CONFIDENCE,
  recordBinding,
} from "./plannerMemory.js";
import type { PlanStep } from "./planTypes.js";

export interface ToolExecutorOptions {
  command: string;
  world: WorldModel;
  plan?: ExecutionPlan;
  resolved?: ResolvedEntities;
  capabilities?: CapabilitySnapshot;
  /** True when user picked disambiguation — skip planner memory record. */
  userOverride?: boolean;
}

export interface StepExecutionRecord {
  index: number;
  tool: string;
  result: ToolResult;
}

export interface ToolExecutorSummary {
  ok: boolean;
  records: StepExecutionRecord[];
  /** Executor never open-ended replans — partial completion only. */
  replanned: false;
}

/**
 * Run a validated ExecutionPlan through the tool registry.
 * Only this module may call executeToolForExecutor().
 * Open-ended replan (GPT loop) is P9 — not implemented here.
 */
export async function executePlan(
  plan: ExecutionPlan,
  options: ToolExecutorOptions,
): Promise<ToolExecutorSummary> {
  return executePlanFromStep(plan, 0, options, []);
}

/** Run plan from a step index — used for save-step-only recovery. */
export async function executePlanFromStep(
  plan: ExecutionPlan,
  startIndex: number,
  options: ToolExecutorOptions,
  priorRecords: StepExecutionRecord[] = [],
): Promise<ToolExecutorSummary> {
  const ctx = createExecutionContext({
    world: options.world,
    resolved: options.resolved ?? {},
    capabilities: options.capabilities ?? emptyCapabilities(),
  });

  const records: StepExecutionRecord[] = [...priorRecords];
  const completedTools = new Set(
    priorRecords.filter((r) => r.result.ok).map((r) => r.tool),
  );

  for (let index = startIndex; index < plan.steps.length; index++) {
    const step = plan.steps[index]!;
    const toolCtx = {
      execution: ctx,
      command: options.command,
      stepIndex: index,
    };

    const rateBlocked = checkRateLimitForTool(step.tool);
    if (rateBlocked) {
      records.push({ index, tool: step.tool, result: rateBlocked });
      return { ok: false, records, replanned: false };
    }

    const deps = getRegisteredTool(step.tool)?.definition.dependsOnTools;
    if (deps?.length) {
      const missing = deps.filter((name) => !completedTools.has(name));
      if (missing.length > 0) {
        records.push({
          index,
          tool: step.tool,
          result: {
            ok: false,
            error: `depends_on_tools:${missing.join(",")}`,
          },
        });
        return { ok: false, records, replanned: false };
      }
    }

    const pass1 = permissionPass1ForStep(
      step.tool,
      options.command,
      ctx.capabilities,
    );
    if (pass1) {
      records.push({ index, tool: step.tool, result: pass1 });
      return { ok: false, records, replanned: false };
    }

    const resolvedArgs = await bindStepArgs(
      step.tool,
      step.args,
      ctx.resolved,
    );

    const pass2 = permissionPass2ForStep(step.tool, resolvedArgs);
    if (pass2) {
      records.push({ index, tool: step.tool, result: pass2 });
      return { ok: false, records, replanned: false };
    }

    const confirmBlocked = await confirmStepIfNeeded(
      step.tool,
      resolvedArgs,
      options.command,
    );
    if (confirmBlocked) {
      records.push({ index, tool: step.tool, result: confirmBlocked });
      return { ok: false, records, replanned: false };
    }

    pushUndoBeforeMutate(step.tool, resolvedArgs);

    if (index > 0) {
      await syncCompoundStepBoundary(
        plan.steps[index - 1]?.tool,
        step.tool,
        plan.steps.length,
      );
    }

    const result = await executeToolForExecutor(
      step.tool,
      toolCtx,
      resolvedArgs,
    );

    const observation = await observeToolStep(
      step.tool,
      resolvedArgs,
      options.world,
      result,
    );
    const enriched: ToolResult = { ...result, observation };

    records.push({ index, tool: step.tool, result: enriched });

    ctx.recentTool = step.tool;
    ctx.lastStepOutput = enriched.output;

    if (!enriched.ok) {
      return { ok: false, records, replanned: false };
    }

    completedTools.add(step.tool);
    recordRateLimitUseForTool(step.tool);
    maybeRecordPlannerMemory(
      options.plan ?? plan,
      step,
      resolvedArgs,
      options.userOverride,
    );

    await refreshExecutionContext(ctx, options.world);
  }

  return { ok: records.every((r) => r.result.ok), records, replanned: false };
}

function maybeRecordPlannerMemory(
  plan: ExecutionPlan,
  step: PlanStep,
  args: Record<string, unknown>,
  userOverride?: boolean,
): void {
  if (userOverride) return;
  if (plan.confidence < PLANNER_MEMORY_RECORD_MIN_CONFIDENCE) return;

  if (
    step.tool === "desktop.launch_app" &&
    typeof args.app === "string" &&
    args.app.trim()
  ) {
    recordBinding({
      phrase: args.app.trim(),
      kind: "app",
      target: args.app.trim(),
      confidence: plan.confidence,
    });
  }
}

function emptyCapabilities(): CapabilitySnapshot {
  return {
    capturedAt: Date.now(),
    manifestVersion: "0.0.0",
    registeredTools: [],
    native: { sendInput: false, uia: false, ocr: false, sidecarUp: false },
    extensions: {},
    permissions: {},
  };
}

export type { ExecutionContext };
