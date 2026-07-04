import type { ActionRunSummary } from "../../automation/types.js";
import type { WorldModel } from "../types.js";
import type { ExecutionPlan } from "./planTypes.js";
import { executePlan, type ToolExecutorSummary } from "./toolExecutor.js";
import { hasRegisteredTool } from "./toolRegistry.js";
import { registerPhase1DesktopTools } from "./tools/desktopTools.js";
import { registerPhase1BrowserTools } from "./tools/browserTools.js";
import {
  registerPhase2FilesystemTools,
} from "./tools/filesystemTools.js";
import { registerPhase1MemoryTools } from "./tools/memoryTools.js";
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
  registerPhase2FilesystemTools();
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

export async function runPlanViaToolExecutor(
  plan: ExecutionPlan,
  command: string,
  world: WorldModel,
  userOverride?: boolean,
): Promise<ToolExecutorSummary> {
  ensurePhase1ToolsRegistered();
  const capabilities =
    getCachedCapabilitySnapshot() ?? (await getCapabilitySnapshot(world));
  return executePlan(plan, {
    command,
    world,
    plan,
    capabilities,
    userOverride,
  });
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
      type: "INSERT_TEXT",
      status: r.result.ok ? "executed" : "failed",
      error: r.result.error,
      detail:
        typeof r.result.output === "string"
          ? r.result.output
          : r.result.ok
            ? `${r.tool} OK`
            : undefined,
    })),
    allSucceeded: summary.ok,
  };
}
