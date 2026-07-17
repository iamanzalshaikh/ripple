import { dialog } from "electron";
import {
  needsSafetyConfirm,
  simulateForKind,
  type SafetySlots,
  type SimulateResult,
} from "./executionSimulator.js";
import {
  isDestructiveKind,
  riskForDesktopKind,
  type ToolRisk,
} from "../tools/toolRegistry.js";
import { recordCommandEvent } from "../../telemetry/commandTelemetry.js";

const AUTOMATION_CONFIRM_KINDS = new Set([
  "run_command",
  "run_script",
  "git_operation",
  "run_tests",
  "run_as_admin",
]);

export type { SafetySlots, SimulateResult };

type ConfirmHandler = (
  title: string,
  simulation: SimulateResult,
) => Promise<boolean>;

let testConfirmHandler: ConfirmHandler | null = null;

/** Test hook — bypass Electron dialog in unit tests. */
export function setConfirmHandlerForTests(handler: ConfirmHandler | null): void {
  testConfirmHandler = handler;
}

export function riskForTool(kind: string): ToolRisk {
  return riskForDesktopKind(kind);
}

export function titleForSafetyKind(kind: string): string {
  switch (kind) {
    case "delete_file":
      return "confirm delete";
    case "move_file":
      return "confirm move";
    case "rename_file":
      return "confirm rename";
    case "create_file":
      return "confirm overwrite";
    case "write_file":
      return "confirm write";
    case "patch_file":
      return "confirm patch";
    case "run_command":
      return "confirm run command";
    case "run_script":
      return "confirm run script";
    case "git_operation":
      return "confirm git operation";
    case "run_tests":
      return "confirm run tests";
    case "copy_file":
      return "confirm copy";
    case "run_as_admin":
      return "confirm run as admin";
    default:
      return "confirm action";
  }
}

export async function confirmDestructiveAction(
  title: string,
  simulation: SimulateResult,
): Promise<boolean> {
  const handler = testConfirmHandler;
  if (handler) {
    return handler(title, simulation);
  }

  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: `Ripple — ${title}`,
    message: simulation.summary.split("\n")[0] ?? title,
    detail: simulation.targets.length
      ? simulation.summary
      : `${simulation.summary}\n\nNo matching files were found.`,
    buttons: ["Confirm", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
}

/**
 * P4.5 — confirm destructive ops when policy requires it.
 * Sets `data._safetyConfirmed` on success.
 */
export async function confirmIfNeeded(
  kind: string,
  slots: SafetySlots,
  data?: Record<string, unknown>,
): Promise<void> {
  if (data?._safetyConfirmed === true) return;
  if (!isDestructiveKind(kind) && !AUTOMATION_CONFIRM_KINDS.has(kind) && kind !== "create_file") return;

  const required = await needsSafetyConfirm(kind, slots);
  if (!required) return;

  const preview = await simulateForKind(kind, slots);
  const title = titleForSafetyKind(kind);
  const ok = await confirmDestructiveAction(title, preview);
  if (!ok) {
    recordCommandEvent({
      command: String(data?.command ?? ""),
      outcome: "cancel",
      detail: `safety_cancel:${kind}`,
    });
    throw new Error("Cancelled");
  }

  recordCommandEvent({
    command: String(data?.command ?? ""),
    outcome: "success",
    detail: `safety_confirmed:${kind}`,
  });
  if (data) data._safetyConfirmed = true;
}

/** @deprecated Use confirmIfNeeded — kept for inline call sites. */
export async function requireSafetyConfirm(
  kind: string,
  slots: SafetySlots,
  data: Record<string, unknown> | undefined,
  title: string,
  simulate: () => Promise<SimulateResult>,
): Promise<void> {
  if (data?._safetyConfirmed === true) return;
  const required = await needsSafetyConfirm(kind, slots);
  if (!required) return;

  const preview = await simulate();
  const ok = await confirmDestructiveAction(title, preview);
  if (!ok) {
    recordCommandEvent({
      command: String(data?.command ?? ""),
      outcome: "cancel",
      detail: title,
    });
    throw new Error("Cancelled");
  }
  recordCommandEvent({
    command: String(data?.command ?? ""),
    outcome: "success",
    detail: `safety_confirmed:${kind}`,
  });
  if (data) data._safetyConfirmed = true;
}
