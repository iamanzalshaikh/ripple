import type { WorldModel } from "../types.js";
import type { ExecutionPlan, PlanStep, ValidationResult } from "./planTypes.js";
import { getToolDefinition } from "./toolDefinitions.js";
import { executionPlanToPayload, isBridgedPlanStep } from "./executionPlanToPayload.js";
import { hasRegisteredTool } from "./toolRegistry.js";
import { permissionForCommand } from "../../automation/safety/permissionEngine.js";

function validateStepArgs(
  step: PlanStep,
  errors: string[],
): void {
  const def = getToolDefinition(step.tool);
  const registered = hasRegisteredTool(step.tool);
  if (!def && !registered) {
    errors.push(`unknown_tool:${step.tool}`);
    return;
  }

  const schema = def?.argsSchema ?? {};
  const bridgedLaunch =
    step.tool === "desktop.launch_app" &&
    (step.args._nativeIntent !== undefined || step.args._desktopPayload !== undefined);

  for (const [key, fieldSchema] of Object.entries(schema)) {
    if (bridgedLaunch && key === "app") continue;
    if (
      fieldSchema.required &&
      (step.args[key] === undefined || step.args[key] === "")
    ) {
      errors.push(`missing_arg:${step.tool}.${key}`);
    }
  }

  if (step.tool === "browser.whatsapp.send") {
    const sending = step.args.send === true;
    const message =
      typeof step.args.message === "string" ? step.args.message : "";
    if (sending && !message.trim()) {
      errors.push("missing_arg:browser.whatsapp.send.message");
    }
  }

  if (step.tool === "browser.youtube.run") {
    const kind = typeof step.args.kind === "string" ? step.args.kind : "";
    const query = typeof step.args.query === "string" ? step.args.query : "";
    if ((kind === "search" || kind === "play") && !query.trim()) {
      errors.push("missing_arg:browser.youtube.run.query");
    }
  }

  if (step.tool === "browser.linkedin.run") {
    const kind = typeof step.args.kind === "string" ? step.args.kind : "";
    const query = typeof step.args.query === "string" ? step.args.query : "";
    if (kind === "search_people" && !query.trim()) {
      errors.push("missing_arg:browser.linkedin.run.query");
    }
  }

  if (step.tool === "filesystem.delete") {
    const hasTarget =
      typeof step.args.path === "string" ||
      typeof step.args.sourceName === "string" ||
      typeof step.args.fileName === "string";
    if (!hasTarget) {
      errors.push("missing_arg:filesystem.delete.path");
    }
  }

  if (step.tool === "desktop.press_keys") {
    const hasKeys = typeof step.args.keys === "string" && step.args.keys.length > 0;
    const hasSeq = Array.isArray(step.args.sequence) && step.args.sequence.length > 0;
    if (!hasKeys && !hasSeq) {
      errors.push(`desktop.press_keys:need_keys_or_sequence`);
    }
  }

  if (step.tool === "desktop.launch_app") {
    const hasApp = typeof step.args.app === "string" && step.args.app.length > 0;
    const hasBridge =
      step.args._nativeIntent !== undefined || step.args._desktopPayload !== undefined;
    if (!hasApp && !hasBridge) {
      errors.push(`missing_arg:${step.tool}.app`);
    }
  }
}

function validateWorldConstraints(
  plan: ExecutionPlan,
  world: WorldModel,
  errors: string[],
): void {
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    const clipboardFilledEarlier = plan.steps
      .slice(0, i)
      .some((s) => s.tool === "system.clipboard.write");
    if (
      step.tool === "desktop.paste" &&
      !world.clipboard.hasText &&
      !clipboardFilledEarlier
    ) {
      errors.push("desktop.paste:clipboard_empty");
    }
    if (
      step.tool === "desktop.press_keys" &&
      typeof step.args.keys === "string" &&
      /^\^v$/i.test(step.args.keys) &&
      !world.clipboard.hasText &&
      !clipboardFilledEarlier
    ) {
      errors.push("desktop.paste:clipboard_empty");
    }
  }
}

function validatePermissions(
  plan: ExecutionPlan,
  command: string,
  errors: string[],
): void {
  const payload = executionPlanToPayload(plan, command);
  if (!payload) return;
  const perm = permissionForCommand(command, payload);
  if (perm.level === "blocked") {
    errors.push(`permission_blocked:${perm.reason ?? "blocked"}`);
  }
}

/** P8.5h — no plan reaches the executor without passing here. */
export function validatePlan(
  plan: ExecutionPlan,
  world: WorldModel,
  command?: string,
): ValidationResult {
  const errors: string[] = [];

  if (plan.needsClarification) {
    return { valid: false, errors: ["needs_clarification"] };
  }

  if (!plan.steps.length) {
    errors.push("empty_plan");
  }

  for (const step of plan.steps) {
    validateStepArgs(step, errors);
    if (!isBridgedPlanStep(step) && !hasRegisteredTool(step.tool)) {
      errors.push(`unbridged_tool:${step.tool}`);
    }
  }

  validateWorldConstraints(plan, world, errors);

  if (command?.trim()) {
    validatePermissions(plan, command.trim(), errors);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], sanitizedPlan: plan };
}

export { passesConfidenceGate, evaluatePlanConfidence } from "./confidenceEngine.js";
