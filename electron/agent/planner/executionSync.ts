import { delay } from "../../automation/delay.js";
import {
  adoptForegroundAsTypingTarget,
  extendCommandFocusGrace,
  restoreFocusContext,
} from "../../focus/focusContext.js";
import {
  isSaveDialogModalLocked,
  runSaveFileDialogFlow,
} from "../../focus/saveDialogMode.js";
import { getFocusedA11yElement } from "../../native/win32Bridge.js";
import { captureObservation } from "../observe.js";
export const LAUNCH_FOCUS_SETTLE_MS = 500;
export const TYPE_PREFLIGHT_WAIT_MS = 300;
export const COMPOUND_STEP_GAP_MS = 200;

const POST_LAUNCH_TOOLS = new Set([
  "desktop.launch_app",
  "desktop.focus_window",
]);

const INPUT_READY_TOOLS = new Set([
  "desktop.type_text",
  "desktop.save_file",
  "desktop.press_keys",
  "desktop.paste",
]);

/** UIA control types that accept keyboard text input. */
export function isEditableControlType(controlType?: string | null): boolean {
  const c = (controlType ?? "").toLowerCase();
  return (
    c.includes("edit") ||
    c.includes("document") ||
    c.includes("text") ||
    c === "combobox"
  );
}

export async function isEditableFocused(): Promise<boolean> {
  const el = await getFocusedA11yElement();
  if (!el?.controlType) return false;
  return isEditableControlType(el.controlType);
}

/** P8.5 — verify foreground has an edit-like control before typing. */
export async function verifyInputFocusReady(options?: {
  settleMs?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const settleMs = options?.settleMs ?? 120;
  if (settleMs > 0) await delay(settleMs);

  if (await isEditableFocused()) {
    return { ok: true };
  }

  const obs = await captureObservation();
  const control = obs.focusedA11y?.controlType ?? "none";
  const proc = obs.foreground?.processName ?? "?";
  return { ok: false, reason: `input_not_ready:${control}:${proc}` };
}

/**
 * After launch_app / focus_window — settle, pin focus, verify input when possible.
 */
export async function focusLockAfterAppLaunch(): Promise<void> {
  if (isSaveDialogModalLocked()) return;

  await delay(LAUNCH_FOCUS_SETTLE_MS);
  await adoptForegroundAsTypingTarget();
  extendCommandFocusGrace(12_000);

  let check = await verifyInputFocusReady({ settleMs: 80 });
  if (check.ok) return;

  await restoreFocusContext();
  await delay(TYPE_PREFLIGHT_WAIT_MS);
  await adoptForegroundAsTypingTarget();
  check = await verifyInputFocusReady({ settleMs: 80 });

  if (process.env.RIPPLE_P85_TRACE !== "0" && !check.ok) {
    console.info(`[ripple-p85] focus-lock soft-continue ${check.reason}`);
  }
}

/** Safe typing gate — refocus before INSERT_TEXT when field is not editable. */
export async function safeTypingPreflight(): Promise<void> {
  if (isSaveDialogModalLocked()) return;
  if (await isEditableFocused()) return;

  await restoreFocusContext();
  await delay(TYPE_PREFLIGHT_WAIT_MS);
  await adoptForegroundAsTypingTarget();

  if (await isEditableFocused()) return;

  await delay(TYPE_PREFLIGHT_WAIT_MS);
}

/**
 * Compound planner guard — wait + verify between launch/focus and input steps.
 */
export async function syncCompoundStepBoundary(
  prevTool: string | undefined,
  nextTool: string,
  totalSteps: number,
): Promise<void> {
  if (totalSteps < 2) return;

  if (nextTool === "desktop.save_file") {
    await delay(COMPOUND_STEP_GAP_MS);
    return;
  }

  if (
    prevTool &&
    POST_LAUNCH_TOOLS.has(prevTool) &&
    INPUT_READY_TOOLS.has(nextTool)
  ) {
    await focusLockAfterAppLaunch();
    await safeTypingPreflight();
    return;
  }

  if (prevTool) {
    await delay(COMPOUND_STEP_GAP_MS);
  }
}

export function stepNeedsInputReadyGate(tool: string): boolean {
  return INPUT_READY_TOOLS.has(tool);
}

/**
 * Strict Save As flow — see runSaveFileDialogFlow in saveDialogMode.ts.
 */
export async function submitSaveDialog(fullPath: string): Promise<void> {
  await runSaveFileDialogFlow(fullPath);
}
