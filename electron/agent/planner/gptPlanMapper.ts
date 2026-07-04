import type { DesktopIntentPlan } from "../../automation/voice/nlu/intentFromLlm.js";
import { nativeIntentFromLlmPlan } from "../../automation/voice/nlu/intentFromLlm.js";
import type { ExecutionPlan, PlanStep } from "./planTypes.js";
import { isKnownTool } from "./toolDefinitions.js";

function stepsFromGptPlan(
  plan: DesktopIntentPlan,
  rawCommand: string,
  normalized: string,
): ExecutionPlan | null {
  const rawSteps = plan.steps;
  if (!rawSteps?.length) return null;

  const steps: PlanStep[] = [];
  for (const step of rawSteps) {
    if (!isKnownTool(step.tool)) return null;
    steps.push({
      tool: step.tool,
      args: step.args ?? {},
      reason: step.reason ?? "gpt_step",
    });
  }
  if (!steps.length) return null;

  return {
    goal: "Multi-step desktop (GPT)",
    confidence: plan.confidence,
    steps,
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "GPT",
  };
}

/** P8.5e — map backend LLM desktop plan → P8.5 ExecutionPlan. */
export function executionPlanFromLlmPlan(
  plan: DesktopIntentPlan,
  rawCommand: string,
  normalized: string,
): ExecutionPlan | null {
  const multi = stepsFromGptPlan(plan, rawCommand, normalized);
  if (multi) return multi;
  if (plan.action === "type_text" || plan.action === "compose_text") {
    const text = plan.entities.text?.trim();
    if (text) {
      return {
        goal: "Type text (GPT)",
        confidence: plan.confidence,
        steps: [
          {
            tool: "desktop.type_text",
            args: {
              text,
              ...(plan.entities.replace_all ? { replaceAll: true } : {}),
            },
            reason: "gpt_type_text",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "GPT",
      };
    }
  }

  if (plan.action === "press_keys") {
    const keys = plan.entities.keys?.trim();
    if (keys) {
      return {
        goal: "Press keys (GPT)",
        confidence: plan.confidence,
        steps: [{ tool: "desktop.press_keys", args: { keys }, reason: "gpt_press_keys" }],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "GPT",
      };
    }
  }

  const native = nativeIntentFromLlmPlan(plan);
  if (!native) return null;

  if (native.kind === "type_text") {
    if (native.text) {
      return {
        goal: "Type text (GPT)",
        confidence: plan.confidence,
        steps: [
          {
            tool: "desktop.type_text",
            args: {
              text: native.text,
              ...(native.replaceAll ? { replaceAll: true } : {}),
            },
            reason: `gpt_${plan.action}`,
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "GPT",
      };
    }
    if (native.keys) {
      return {
        goal: "Press keys (GPT)",
        confidence: plan.confidence,
        steps: [
          {
            tool: "desktop.press_keys",
            args: { keys: native.keys },
            reason: `gpt_${plan.action}`,
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "GPT",
      };
    }
    return null;
  }

  return {
    goal: `Desktop action: ${plan.action}`,
    confidence: plan.confidence,
    steps: [
      {
        tool: "desktop.launch_app",
        args: { _nativeIntent: native },
        reason: `gpt_${plan.action}`,
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "GPT",
  };
}
