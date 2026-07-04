import type { ExecutionPlan } from "./planTypes.js";
import type { WorldModel } from "../types.js";
import { PLANNER_VERSION } from "./plannerConstants.js";
import { TOOL_MANIFEST_VERSION } from "./toolDefinitions.js";

/** Stamp version provenance on plans before execute / cache / shadow log. */
export function stampExecutionPlan(
  plan: ExecutionPlan,
  world?: WorldModel,
): ExecutionPlan {
  return {
    ...plan,
    plannerVersion: plan.plannerVersion ?? PLANNER_VERSION,
    toolManifestVersion: plan.toolManifestVersion ?? TOOL_MANIFEST_VERSION,
    worldVersion:
      plan.worldVersion ??
      (world ? String(world.capturedAt || Date.now()) : undefined),
  };
}
