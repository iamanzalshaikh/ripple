import type { CommandResultPayload } from "../automation/types.js";
import type { UniversalPlanResult, UniversalToolId, WorldModel } from "./types.js";
import { runPlannerPipeline, runPlannerPipelineAsync } from "./planner/plannerPipeline.js";
import { buildExecutorPayload } from "./planner/plannerExecutor.js";
import { executionPlanToPayload } from "./planner/executionPlanToPayload.js";
import type { PlannerPipelineResult } from "./planner/planTypes.js";
import { buildTypingPayloadFromInput, buildTypingPayloadFromTypeIntent } from "./typingPayload.js";
import { commandPayloadFromIntent } from "../automation/desktop/desktopCommand.js";
import { parseDesktopInputFallback } from "./parseDesktopInput.js";

function defaultWorldModel(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, windowUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: true, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: false,
      sendInput: true,
      uia: false,
      ocr: false,
    },
    activeGoal: null,
  };
}

/**
 * P8.5 Universal Intent Planner — single entry for natural language → tools.
 * Wave 1: L0 + validation + shadow logging; GPT fallback via planExecute when deferred.
 */
export function planUniversalIntent(
  command: string,
  world?: WorldModel | null,
): UniversalPlanResult {
  const w = world ?? defaultWorldModel();
  return pipelineToUniversalResult(runPlannerPipeline({ command, world: w }), command);
}

export function universalPlanToCommandPayload(
  plan: Extract<UniversalPlanResult, { kind: "execute" }>,
  command: string,
): CommandResultPayload | null {
  if (plan.payload.desktopPayload) {
    return plan.payload.desktopPayload as CommandResultPayload;
  }
  if (plan.payload.parsed) {
    return buildTypingPayloadFromInput(
      command,
      plan.payload.parsed as NonNullable<ReturnType<typeof parseDesktopInputFallback>>,
    );
  }
  if (plan.payload.intent?.kind === "type_text") {
    return buildTypingPayloadFromTypeIntent(command, plan.payload.intent);
  }
  if (plan.payload.intent) {
    return commandPayloadFromIntent(plan.payload.intent, command, " (universal)");
  }
  return null;
}

/** Run full P8.5 pipeline and return executable payload when L0 matches. */
export function tryP85CommandPayload(
  command: string,
  world: WorldModel,
): CommandResultPayload | null {
  return pipelineResultToPayload(runPlannerPipeline({ command, world }), command, world);
}

export async function tryP85CommandPayloadAsync(
  command: string,
  world: WorldModel,
  getAccessToken: () => Promise<string | null>,
): Promise<CommandResultPayload | null> {
  const pipeline = await runPlannerPipelineAsync({ command, world, getAccessToken });
  return pipelineResultToPayload(pipeline, command, world);
}

function pipelineResultToPayload(
  pipeline: PlannerPipelineResult,
  command: string,
  world: WorldModel,
): CommandResultPayload | null {
  if (pipeline.kind !== "execute") return null;
  const built = buildExecutorPayload(pipeline.plan, command, world);
  if (built.kind === "payload") return built.payload;
  return executionPlanToPayload(pipeline.plan, command);
}

export function getP85DeferReason(
  command: string,
  world: WorldModel,
): string | null {
  const pipeline = runPlannerPipeline({ command, world });
  if (pipeline.kind === "defer") return pipeline.reason;
  return null;
}

export async function planUniversalIntentAsync(
  command: string,
  world: WorldModel,
  getAccessToken: () => Promise<string | null>,
): Promise<UniversalPlanResult> {
  const pipeline = await runPlannerPipelineAsync({ command, world, getAccessToken });
  return pipelineToUniversalResult(pipeline, command);
}

function toolIdFromStep(tool: string): UniversalToolId {
  if (tool === "desktop.type_text") return "desktop.type_text";
  if (
    tool === "desktop.press_keys" ||
    tool === "desktop.paste" ||
    tool === "desktop.copy" ||
    tool === "desktop.select_all"
  ) {
    return "desktop.press_keys";
  }
  return "desktop.open";
}

function pipelineToUniversalResult(
  pipeline: PlannerPipelineResult,
  command: string,
): UniversalPlanResult {
  if (pipeline.kind === "clarify") {
    return {
      kind: "clarify",
      confidence: pipeline.confidence,
      question: pipeline.question,
      options: pipeline.options,
      reason: pipeline.reason,
    };
  }

  if (pipeline.kind === "partial") {
    return {
      kind: "clarify",
      confidence: pipeline.confidence,
      question: pipeline.question,
      reason: pipeline.reason,
    };
  }

  if (pipeline.kind === "defer") {
    return { kind: "defer", reason: pipeline.reason };
  }

  const plan = pipeline.plan;
  const firstStep = plan.steps[0];
  if (!firstStep) {
    return { kind: "defer", reason: "empty_plan" };
  }

  const payload = executionPlanToPayload(plan, command);
  if (!payload) {
    return { kind: "defer", reason: "payload_build_failed" };
  }

  if (payload.intent === "typing" && firstStep.tool === "desktop.type_text") {
    return {
      kind: "execute",
      tool: "desktop.type_text",
      confidence: plan.confidence,
      payload: {
        intent: {
          kind: "type_text",
          text: String(firstStep.args.text ?? ""),
          replaceAll: firstStep.args.replaceAll === true,
        },
        parsed: parseDesktopInputFallback(plan.normalizedUtterance),
      },
      reason: `p85:${plan.source}`,
    };
  }

  if (payload.intent === "typing") {
    const parsed = parseDesktopInputFallback(plan.normalizedUtterance);
    return {
      kind: "execute",
      tool: parsed?.mode === "text" ? "desktop.type_text" : toolIdFromStep(firstStep.tool),
      confidence: plan.confidence,
      payload: { parsed, desktopPayload: payload },
      reason: `p85:${plan.source}`,
    };
  }

  return {
    kind: "execute",
    tool: "desktop.open",
    confidence: plan.confidence,
    payload: { desktopPayload: payload },
    reason: `p85:${plan.source}`,
  };
}
