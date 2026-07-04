import type { ExecutionPlan } from "./planTypes.js";
import { getToolDefinition } from "./toolDefinitions.js";
import { plannerConfig } from "./plannerConfig.js";

export type ConfidenceDecision =
  | { action: "execute"; band: "high" | "l0" }
  | { action: "execute_best_effort"; band: "medium" }
  | { action: "clarify"; band: "low"; reason: string };

const DESTRUCTIVE_TOOLS = new Set([
  "desktop.close_window",
]);

const COMMUNICATION_PREFIXES = ["browser.whatsapp.", "browser.gmail.", "communication."];

function planUsesCommunicationTools(plan: ExecutionPlan): boolean {
  return plan.steps.some(
    (s) =>
      COMMUNICATION_PREFIXES.some((p) => s.tool.startsWith(p)) ||
      getToolDefinition(s.tool)?.category === "communication",
  );
}

/** P8.5f — confidence gate with configurable thresholds. */
export function evaluatePlanConfidence(plan: ExecutionPlan): ConfidenceDecision {
  for (const step of plan.steps) {
    if (DESTRUCTIVE_TOOLS.has(step.tool) && plan.confidence < plannerConfig.destructiveFloor) {
      return {
        action: "clarify",
        band: "low",
        reason: `destructive_tool_low_confidence:${step.tool}`,
      };
    }
  }

  if (planUsesCommunicationTools(plan) && plan.confidence < plannerConfig.executeThreshold) {
    return {
      action: "clarify",
      band: "low",
      reason: "communication_needs_high_confidence",
    };
  }

  if (plan.source === "L0" && plan.confidence >= plannerConfig.l0BypassThreshold) {
    return { action: "execute", band: "l0" };
  }

  if (plan.confidence >= plannerConfig.executeThreshold) {
    return { action: "execute", band: "high" };
  }

  if (plan.confidence >= plannerConfig.clarifyThreshold) {
    return { action: "execute_best_effort", band: "medium" };
  }

  return {
    action: "clarify",
    band: "low",
    reason: "below_clarify_threshold",
  };
}

export function passesConfidenceGate(plan: ExecutionPlan): boolean {
  const decision = evaluatePlanConfidence(plan);
  return decision.action === "execute" || decision.action === "execute_best_effort";
}

export function confidenceDecisionLabel(decision: ConfidenceDecision): string {
  if (decision.action === "execute") return `execute:${decision.band}`;
  if (decision.action === "execute_best_effort") return "execute:best_effort";
  return `clarify:${decision.reason}`;
}
