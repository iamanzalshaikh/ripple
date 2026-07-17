import type { WorldModel } from "../types.js";
import type { ExecutionPlan, PlanStep, ValidationResult } from "./planTypes.js";
import { getToolDefinition } from "./toolDefinitions.js";
import { executionPlanToPayload, isBridgedPlanStep } from "./executionPlanToPayload.js";
import { hasRegisteredTool } from "./toolRegistry.js";
import { permissionForCommand } from "../../automation/safety/permissionEngine.js";
import { isBlockedShellCommand } from "../../automation/shell/runCommand.js";

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
    const value = step.args[key];
    const allowEmptyContent =
      step.tool === "filesystem.write_file" && key === "content";
    if (
      fieldSchema.required &&
      (value === undefined || (value === "" && !allowEmptyContent))
    ) {
      errors.push(`missing_arg:${step.tool}.${key}`);
    }
  }

  if (step.tool === "browser.whatsapp.send") {
    const mode =
      typeof step.args.mode === "string" ? step.args.mode : "message";
    if (mode === "referential_send") {
      const contact =
        typeof step.args.contact === "string" ? step.args.contact : "";
      if (!contact.trim()) {
        errors.push("missing_arg:browser.whatsapp.send.contact");
      }
    } else {
      const sending = step.args.send === true;
      const message =
        typeof step.args.message === "string" ? step.args.message : "";
      if (sending && !message.trim()) {
        errors.push("missing_arg:browser.whatsapp.send.message");
      }
    }
  }

  if (step.tool === "browser.instagram.run") {
    const kind = typeof step.args.kind === "string" ? step.args.kind : "";
    const text = typeof step.args.text === "string" ? step.args.text : "";
    const username =
      typeof step.args.username === "string" ? step.args.username : "";
    if (kind === "message" && (!username.trim() || !text.trim())) {
      errors.push("missing_arg:browser.instagram.run.message");
    }
    if (kind === "compose" && !text.trim()) {
      errors.push("missing_arg:browser.instagram.run.text");
    }
  }

  if (step.tool === "browser.notion.run") {
    const kind = typeof step.args.kind === "string" ? step.args.kind : "";
    if (kind === "create_page" && step.args.pasteClipboard !== true) {
      const title = typeof step.args.title === "string" ? step.args.title : "";
      const body = typeof step.args.body === "string" ? step.args.body : "";
      if (!title.trim() && !body.trim()) {
        errors.push("missing_arg:browser.notion.run.content");
      }
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

  if (step.tool === "filesystem.search") {
    const query =
      typeof step.args.query === "string"
        ? step.args.query
        : typeof step.args.name === "string"
          ? step.args.name
          : "";
    if (!query.trim()) {
      errors.push("missing_arg:filesystem.search.query");
    }
  }

  if (
    step.tool === "filesystem.read_file" ||
    step.tool === "filesystem.get_metadata"
  ) {
    const hasPath = typeof step.args.path === "string" && step.args.path.trim();
    const hasFileName =
      typeof step.args.fileName === "string" && step.args.fileName.trim();
    if (!hasPath && !hasFileName) {
      errors.push(`missing_arg:${step.tool}.path`);
    }
    const path =
      typeof step.args.path === "string" ? step.args.path : "";
    if (path.includes("..")) {
      errors.push(`permission_blocked:${step.tool}:path_traversal`);
    }
  }

  if (step.tool === "filesystem.write_file") {
    const path = typeof step.args.path === "string" ? step.args.path : "";
    if (!path.trim()) {
      errors.push("missing_arg:filesystem.write_file.path");
    } else if (path.includes("..")) {
      errors.push("permission_blocked:filesystem.write_file:path_traversal");
    }
    if (typeof step.args.content !== "string") {
      errors.push("missing_arg:filesystem.write_file.content");
    }
  }

  if (step.tool === "filesystem.patch_file") {
    const path = typeof step.args.path === "string" ? step.args.path : "";
    if (!path.trim()) {
      errors.push("missing_arg:filesystem.patch_file.path");
    } else if (path.includes("..")) {
      errors.push("permission_blocked:filesystem.patch_file:path_traversal");
    }
    const hasFindReplace =
      typeof step.args.find === "string" &&
      typeof step.args.replace === "string";
    const hasContent = typeof step.args.content === "string";
    if (!hasFindReplace && !hasContent) {
      errors.push("missing_arg:filesystem.patch_file.patch");
    }
  }

  if (step.tool === "desktop.press_keys") {
    const hasKeys = typeof step.args.keys === "string" && step.args.keys.length > 0;
    const hasSeq = Array.isArray(step.args.sequence) && step.args.sequence.length > 0;
    if (!hasKeys && !hasSeq) {
      errors.push(`desktop.press_keys:need_keys_or_sequence`);
    }
  }

  if (step.tool === "desktop.press_key") {
    const key = typeof step.args.key === "string" ? step.args.key.trim() : "";
    if (!key) {
      errors.push("missing_arg:desktop.press_key.key");
    }
  }

  if (step.tool === "desktop.hotkey") {
    const chord =
      typeof step.args.chord === "string"
        ? step.args.chord.trim()
        : typeof step.args.keys === "string"
          ? step.args.keys.trim()
          : "";
    if (!chord) {
      errors.push("missing_arg:desktop.hotkey.chord");
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

  if (step.tool === "browser.open_url") {
    const url = typeof step.args.url === "string" ? step.args.url : "";
    if (!url.trim()) {
      errors.push("missing_arg:browser.open_url.url");
    }
  }

  if (step.tool === "browser.type") {
    const text = typeof step.args.text === "string" ? step.args.text : "";
    if (!text.trim()) {
      errors.push("missing_arg:browser.type.text");
    }
  }

  if (step.tool === "browser.find_element" || step.tool === "browser.click") {
    const selector =
      typeof step.args.selector === "string" ? step.args.selector.trim() : "";
    const text = typeof step.args.text === "string" ? step.args.text.trim() : "";
    const ariaLabel =
      typeof step.args.ariaLabel === "string" ? step.args.ariaLabel.trim() : "";
    const hasCoords =
      typeof step.args.x === "number" && typeof step.args.y === "number";
    if (!selector && !text && !ariaLabel && !hasCoords) {
      errors.push(`missing_arg:${step.tool}.target`);
    }
  }

  if (step.tool === "automation.run_command") {
    const command =
      typeof step.args.command === "string" ? step.args.command.trim() : "";
    if (!command) {
      errors.push("missing_arg:automation.run_command.command");
    } else if (isBlockedShellCommand(command)) {
      errors.push("permission_blocked:automation.run_command:injection");
    }
  }

  if (step.tool === "automation.run_script") {
    const scriptPath =
      typeof step.args.scriptPath === "string" ? step.args.scriptPath.trim() : "";
    if (!scriptPath) {
      errors.push("missing_arg:automation.run_script.scriptPath");
    }
  }

  if (step.tool === "automation.git_operation") {
    const operation =
      typeof step.args.operation === "string" ? step.args.operation.trim() : "";
    const cwd = typeof step.args.cwd === "string" ? step.args.cwd.trim() : "";
    if (!operation) errors.push("missing_arg:automation.git_operation.operation");
    if (!cwd) errors.push("missing_arg:automation.git_operation.cwd");
  }

  if (step.tool === "automation.find_code") {
    const query = typeof step.args.query === "string" ? step.args.query.trim() : "";
    const projectRoot =
      typeof step.args.projectRoot === "string" ? step.args.projectRoot.trim() : "";
    if (!query) errors.push("missing_arg:automation.find_code.query");
    if (!projectRoot) errors.push("missing_arg:automation.find_code.projectRoot");
  }

  if (
    step.tool === "automation.scan_project" ||
    step.tool === "automation.analyze_codebase" ||
    step.tool === "automation.typecheck" ||
    step.tool === "automation.lint"
  ) {
    const projectRoot =
      typeof step.args.projectRoot === "string" ? step.args.projectRoot.trim() : "";
    if (!projectRoot) errors.push(`missing_arg:${step.tool}.projectRoot`);
  }

  if (step.tool === "automation.run_tests") {
    const projectRoot =
      typeof step.args.projectRoot === "string" ? step.args.projectRoot.trim() : "";
    if (!projectRoot) errors.push("missing_arg:automation.run_tests.projectRoot");
  }

  if (step.tool === "automation.open_project") {
    const hint =
      typeof step.args.projectHint === "string" ? step.args.projectHint.trim() : "";
    const path = typeof step.args.path === "string" ? step.args.path.trim() : "";
    if (!hint && !path) {
      errors.push("missing_arg:automation.open_project.hint_or_path");
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
      (step.tool === "desktop.press_keys" || step.tool === "desktop.hotkey") &&
      typeof step.args.keys === "string" &&
      /^\^v$/i.test(step.args.keys) &&
      !world.clipboard.hasText &&
      !clipboardFilledEarlier
    ) {
      errors.push("desktop.paste:clipboard_empty");
    }
    if (
      step.tool === "desktop.hotkey" &&
      typeof step.args.chord === "string" &&
      /^\^v$/i.test(step.args.chord) &&
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
