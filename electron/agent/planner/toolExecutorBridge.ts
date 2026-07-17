import type { ActionRunSummary } from "../../automation/types.js";
import type { WorldModel } from "../types.js";
import type { ExecutionPlan } from "./planTypes.js";
import {
  executePlan,
  executePlanFromStep,
  type StepExecutionRecord,
  type ToolExecutorSummary,
} from "./toolExecutor.js";
import { hasRegisteredTool } from "./toolRegistry.js";
import { registerPhase1DesktopTools } from "./tools/desktopTools.js";
import { registerPhase1BrowserTools } from "./tools/browserTools.js";
import {
  registerPhase2FilesystemTools,
} from "./tools/filesystemTools.js";
import { registerPhase5BrowserTools } from "./tools/browserGenericTools.js";
import { registerPhase5AutomationTools } from "./tools/automationTools.js";
import { registerPhase5AiTools } from "./tools/aiTools.js";
import { registerPhase1MemoryTools } from "./tools/memoryTools.js";
import { registerPhase6MemoryIntelligenceTools } from "./tools/memoryIntelligenceTools.js";
import { registerPhase6ContextTools } from "./tools/contextTools.js";
import { registerPhase56OsTools } from "./tools/osTools.js";
import { registerPhase1SystemTools } from "./tools/systemTools.js";
import { getCachedCapabilitySnapshot } from "./capabilitySnapshotCache.js";
import { getCapabilitySnapshot } from "./capabilityService.js";

export function isToolExecutorRouteEnabled(): boolean {
  if (process.env.RIPPLE_P85_TOOL_EXECUTOR === "0") return false;
  if (process.env.RIPPLE_P85_TOOL_EXECUTOR === "1") return true;
  return true;
}

export function ensureP85ToolsRegistered(): void {
  registerPhase1DesktopTools();
  registerPhase1BrowserTools();
  registerPhase1MemoryTools();
  registerPhase6MemoryIntelligenceTools();
  registerPhase6ContextTools();
  registerPhase2FilesystemTools();
  registerPhase5BrowserTools();
  registerPhase5AutomationTools();
  registerPhase5AiTools();
  registerPhase56OsTools();
  registerPhase1SystemTools();
}

/** @deprecated use ensureP85ToolsRegistered */
export function ensurePhase1ToolsRegistered(): void {
  ensureP85ToolsRegistered();
}

/** True when every plan step has a registered execute handler. */
export function planEligibleForToolExecutor(plan: ExecutionPlan): boolean {
  ensurePhase1ToolsRegistered();
  if (plan.steps.length === 0) return false;
  return plan.steps.every((step) => {
    if (step.args._desktopPayload !== undefined) {
      return false;
    }
    if (step.tool === "desktop.launch_app") {
      return (
        hasRegisteredTool(step.tool) &&
        (typeof step.args.app === "string" ||
          step.args._nativeIntent !== undefined)
      );
    }
    return hasRegisteredTool(step.tool);
  });
}

async function executorOptions(
  plan: ExecutionPlan,
  command: string,
  world: WorldModel,
  userOverride?: boolean,
) {
  ensureP85ToolsRegistered();
  const capabilities =
    getCachedCapabilitySnapshot() ?? (await getCapabilitySnapshot(world));
  return { command, world, plan, capabilities, userOverride };
}

export async function runPlanViaToolExecutor(
  plan: ExecutionPlan,
  command: string,
  world: WorldModel,
  userOverride?: boolean,
): Promise<ToolExecutorSummary> {
  return executePlan(
    plan,
    await executorOptions(plan, command, world, userOverride),
  );
}

/** Retry from a failed step — keeps prior successful step records. */
export async function runPlanViaToolExecutorFromStep(
  plan: ExecutionPlan,
  startIndex: number,
  command: string,
  world: WorldModel,
  priorRecords: StepExecutionRecord[] = [],
  userOverride?: boolean,
): Promise<ToolExecutorSummary> {
  return executePlanFromStep(
    plan,
    startIndex,
    await executorOptions(plan, command, world, userOverride),
    priorRecords,
  );
}

export function mergeExecutorSummaries(
  prior: ToolExecutorSummary,
  retry: ToolExecutorSummary,
  fromIndex: number,
): ToolExecutorSummary {
  const kept = prior.records.filter(
    (r) => r.index < fromIndex && r.result.ok,
  );
  const tail = retry.records.filter((r) => r.index >= fromIndex);
  const records = [...kept, ...tail].sort((a, b) => a.index - b.index);
  return {
    ok: records.length > 0 && records.every((r) => r.result.ok),
    records,
    replanned: false,
  };
}

export function toolExecutorSummaryToActionRunSummary(
  plan: ExecutionPlan,
  summary: ToolExecutorSummary,
  commandId: string,
): ActionRunSummary {
  return {
    command_id: commandId,
    records: summary.records.map((r) => ({
      index: r.index,
      type: r.tool.startsWith("filesystem.") ||
        r.tool.startsWith("automation.") ||
        r.tool.startsWith("memory.") ||
        r.tool.startsWith("context.") ||
        r.tool === "desktop.get_active_window" ||
        r.tool === "desktop.get_current_workspace"
        ? "WORKFLOW"
        : r.tool.startsWith("browser.")
          ? "OPEN_URL"
          : "INSERT_TEXT",
      status: r.result.ok ? "executed" : "failed",
      error: r.result.error,
      detail:
        typeof r.result.output === "string"
          ? r.result.output
          : r.result.output != null
            ? JSON.stringify(r.result.output, null, 2)
            : r.result.ok
              ? `${r.tool} OK`
              : undefined,
    })),
    allSucceeded: summary.ok,
  };
}
