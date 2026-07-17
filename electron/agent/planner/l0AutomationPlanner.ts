import type { L0PlannerResult } from "./planTypes.js";
import { automationIntentToPlanSteps } from "./automationIntentToPlanSteps.js";
import { parseAutomationClause } from "./parseAutomationClause.js";
import { getCompoundParts } from "./utteranceClassifier.js";

export function tryL0AutomationPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const parts = getCompoundParts(rawCommand, normalized);
  if (parts && parts.length >= 2) return null;

  const intent =
    parseAutomationClause(rawCommand) ?? parseAutomationClause(normalized);
  if (!intent) return null;

  const steps = automationIntentToPlanSteps(intent);
  if (!steps.length) return null;

  return {
    kind: "plan",
    plan: {
      goal: steps.map((s) => s.tool).join(" → "),
      confidence: 0.9,
      steps,
      rawUtterance: rawCommand,
      normalizedUtterance: normalized,
      source: "L0",
    },
  };
}
