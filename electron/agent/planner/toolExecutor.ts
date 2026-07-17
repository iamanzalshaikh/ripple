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
import { passesConfidenceGate, validatePlan } from "./planValidator.js";
import { parseActionPlanDraftOutput } from "../../automation/ai/aiHelpers.js";
import { stampExecutionPlan } from "./planStamping.js";
import {
  getActiveWorkspace,
  getLastProjectPath,
  pushRecentContext,
  setActiveWorkspace,
} from "../../storage/workContext.js";
import { recordUsage } from "../../storage/usageStats.js";

export interface ToolExecutorOptions {
  command: string;
  world: WorldModel;
  plan?: ExecutionPlan;
  resolved?: ResolvedEntities;
  capabilities?: CapabilitySnapshot;
  /** True when user picked disambiguation — skip planner memory record. */
  userOverride?: boolean;
  /**
   * Depth of nested `ai.generate_action_plan` adoption (0 = root).
   * Prevents recursive draft loops.
   */
  aiPlanDepth?: number;
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

  // Prefer live Cursor/VS Code workspace, then sticky P6 memory.
  if (!ctx.resolved.projectRoot) {
    let live = "";
    try {
      const { resolveLiveIdeContext } = await import("./tools/desktopTools.js");
      live = resolveLiveIdeContext()?.location?.trim() || "";
    } catch {
      /* ignore */
    }
    const sticky =
      getActiveWorkspace()?.path?.trim() || getLastProjectPath()?.trim() || "";
    const chosen = live || sticky;
    if (chosen) {
      ctx.resolved.projectRoot = chosen;
      ctx.currentFolder = chosen;
    }
  }

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
      step.reason,
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

    if (
      enriched.ok &&
      typeof enriched.output === "string" &&
      (step.tool === "filesystem.list_directory" ||
        step.tool === "filesystem.read_file" ||
        step.tool === "filesystem.search" ||
        step.tool === "filesystem.get_metadata" ||
        step.tool === "desktop.get_active_window" ||
        step.tool.startsWith("automation.") ||
        step.tool.startsWith("ai.") ||
        step.tool.startsWith("memory.") ||
        step.tool.startsWith("context."))
    ) {
      console.info(`[ripple-desktop] ${step.tool} result:\n${enriched.output}`);
    }

    ctx.recentTool = step.tool;
    ctx.lastStepOutput = enriched.output;

    if (!enriched.ok) {
      return { ok: false, records, replanned: false };
    }

    // P5.5 — draft plan re-entry: validate then execute (tool itself never calls executePlan).
    if (
      step.tool === "ai.generate_action_plan" &&
      (options.aiPlanDepth ?? 0) < 1
    ) {
      const draft = parseActionPlanDraftOutput(enriched.output);
      if (draft && draft.steps.length > 0) {
        const validation = validatePlan(draft, options.world, options.command);
        if (validation.valid && passesConfidenceGate(draft)) {
          const adopted = stampExecutionPlan(
            validation.sanitizedPlan ?? draft,
            options.world,
          );
          console.info(
            `[ripple-p85] ai.generate_action_plan adopted draft steps=${adopted.steps.length}`,
          );
          const nested = await executePlanFromStep(
            adopted,
            0,
            { ...options, plan: adopted, aiPlanDepth: 1 },
            [],
          );
          records.push(...nested.records.map((r) => ({
            ...r,
            index: records.length + r.index,
          })));
          if (!nested.ok) {
            return { ok: false, records, replanned: false };
          }
        } else {
          console.info(
            `[ripple-p85] ai.generate_action_plan draft rejected: ${validation.errors.join(",") || "confidence"}`,
          );
        }
      }
    }

    updateExecutionBindings(ctx, step.tool, resolvedArgs, enriched);
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

function updateExecutionBindings(
  ctx: ExecutionContext,
  tool: string,
  args: Record<string, unknown>,
  result: ToolResult,
): void {
  if (tool !== "automation.open_project" || !result.ok) return;

  const directPath =
    typeof args.path === "string" && args.path.trim() ? args.path.trim() : null;
  const outputPath =
    typeof result.output === "string"
      ? result.output.match(
          /(?:Opened project in [^:]+|Opened folder|Focused existing [^:]+):\s*([A-Za-z]:.+)\s*$/i,
        )?.[1]?.trim()
      : undefined;
  // Prefer path from tool output (fuzzy-resolved) over the spoken/typed path.
  const projectRoot = outputPath ?? directPath;
  if (!projectRoot) return;

  ctx.resolved.projectRoot = projectRoot;
  ctx.currentFolder = projectRoot;

  try {
    setActiveWorkspace({ path: projectRoot });
    pushRecentContext({
      projectPath: projectRoot,
      command: "automation.open_project",
    });
    recordUsage("path", projectRoot);
  } catch {
    /* memory write is best-effort */
  }
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
