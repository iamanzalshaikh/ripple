import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../../automation/types.js";
import type { WorldModel } from "../types.js";
import { executionPlanToPayload } from "./executionPlanToPayload.js";
import { getPermissionBlockMessage } from "../../automation/safety/permissionGate.js";
import type { ExecutionPlan } from "./planTypes.js";
import { passesConfidenceGate, validatePlan } from "./planValidator.js";
import { traceExecutorPayload } from "./plannerTrace.js";
import {
  isToolExecutorRouteEnabled,
  planEligibleForToolExecutor,
} from "./toolExecutorBridge.js";

export type PlannerExecutorResult =
  | { kind: "payload"; plan: ExecutionPlan; payload: CommandResultPayload }
  | {
      kind: "executor";
      plan: ExecutionPlan;
      payload: CommandResultPayload;
    }
  | { kind: "clarify"; question: string; plan: ExecutionPlan }
  | { kind: "invalid"; errors: string[] };

/**
 * P8.5i — validate a plan and bridge to existing P7 CommandResultPayload,
 * or return executor kind when tool executor route is enabled for all steps.
 */
export function buildExecutorPayload(
  plan: ExecutionPlan,
  command: string,
  world: WorldModel,
): PlannerExecutorResult {
  const validation = validatePlan(plan, world, command);
  if (!validation.valid) {
    return { kind: "invalid", errors: validation.errors };
  }

  const sanitized = validation.sanitizedPlan ?? plan;
  traceExecutorPayload(sanitized.steps.map((s) => s.tool));
  if (!passesConfidenceGate(sanitized)) {
    return {
      kind: "clarify",
      question:
        sanitized.clarificationQuestion ??
        "I'm not sure what you meant. Can you say that again more specifically?",
      plan: sanitized,
    };
  }

  let payload = executionPlanToPayload(sanitized, command);
  // Tool-only plans (memory.*, context.*, …) must still reach the executor even if
  // the legacy INSERT_TEXT bridge omits a prefix — synthesize a minimal payload.
  if (
    (!payload?.actions?.length || !payload.command_id) &&
    isToolExecutorRouteEnabled() &&
    planEligibleForToolExecutor(sanitized)
  ) {
    payload = {
      command_id: randomUUID(),
      intent: "workflow",
      output_type: "action",
      actions: sanitized.steps.map((step) => ({
        type: "INSERT_TEXT" as const,
        status: "pending" as const,
        data: { _p85Tool: step.tool, ...step.args },
      })),
    };
  }
  if (!payload?.actions?.length || !payload.command_id) {
    return { kind: "invalid", errors: ["payload_build_failed"] };
  }

  const blocked = getPermissionBlockMessage(command, payload);
  if (blocked) {
    return { kind: "invalid", errors: [`permission_blocked:${blocked}`] };
  }

  if (
    isToolExecutorRouteEnabled() &&
    planEligibleForToolExecutor(sanitized)
  ) {
    return { kind: "executor", plan: sanitized, payload };
  }

  return { kind: "payload", plan: sanitized, payload };
}