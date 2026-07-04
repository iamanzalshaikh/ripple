import type { NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import type { ExecutionPlan } from "./planTypes.js";
import { nativeIntentToPlanStep } from "./nativeIntentToPlanStep.js";

/** Build a single-step L0 plan from a resolved native intent (correct tool per kind). */
export function planFromNativeIntent(
  intent: NativeCommandIntent,
  rawCommand: string,
  normalized: string,
  opts?: { goal?: string; confidence?: number; reason?: string },
): ExecutionPlan | null {
  const step = nativeIntentToPlanStep(intent);
  if (!step) return null;

  return {
    goal: opts?.goal ?? `Desktop: ${intent.kind}`,
    confidence: opts?.confidence ?? 0.9,
    steps: [step],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}
