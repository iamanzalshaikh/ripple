import { delay } from "../../automation/delay.js";
import {
  adoptForegroundAsTypingTarget,
  extendCommandFocusGrace,
  isRippleApplicationWindow,
  restoreFocusContext,
} from "../../focus/focusContext.js";
import {
  isSaveDialogModalLocked,
  runSaveFileDialogFlow,
  type SaveFlowOptions,
} from "../../focus/saveDialogMode.js";
import { getFocusedA11yElement } from "../../native/win32Bridge.js";
import { captureObservation } from "../observe.js";
import { matchesMainDocumentA11y } from "../../focus/saveDialogMode.js";
import { ensureEditorKeyboardFocus } from "../editorFocus.js";

function isClassicEditorProcess(processName?: string | null): boolean {
  const p = (processName ?? "").toLowerCase();
  return p === "notepad" || p.includes("wordpad");
}

export const LAUNCH_FOCUS_SETTLE_MS = 500;
export const ELECTRON_EDITOR_SETTLE_MS = 1800;
export const TYPE_PREFLIGHT_WAIT_MS = 300;
export const COMPOUND_STEP_GAP_MS = 200;
export const PAINT_FOCUS_STABLE_MS = 350;
export const PAINT_FOCUS_MAX_WAIT_MS = 3500;

const POST_LAUNCH_TOOLS = new Set([
  "desktop.launch_app",
  "desktop.focus_window",
]);

const INPUT_READY_TOOLS = new Set([
  "desktop.type_text",
  "desktop.save_file",
  "desktop.press_keys",
  "desktop.press_key",
  "desktop.hotkey",
  "desktop.paste",
]);

const POST_LAUNCH_FILE_TOOLS = new Set([
  "filesystem.write_file",
  "filesystem.create_file",
  "desktop.save_file",
]);

const PAINT_STEP_TOOLS = new Set([
  "desktop.mouse_move",
  "desktop.mouse_drag",
  "desktop.paint_op",
]);

/** UIA control types that accept keyboard text input (generic apps). */
export function isEditableControlType(controlType?: string | null): boolean {
  const c = (controlType ?? "").toLowerCase();
  return (
    c.includes("edit") ||
    c.includes("document") ||
    c.includes("text")
  );
}

/** True when the focused control is the real typing surface (Notepad document, not tab combo). */
export async function isTypingTargetReady(): Promise<boolean> {
  const el = await getFocusedA11yElement();
  if (!el?.controlType) return false;
  const obs = await captureObservation();
  const proc = obs.foreground?.processName ?? "";
  if (isClassicEditorProcess(proc)) {
    return matchesMainDocumentA11y(el);
  }
  return isEditableControlType(el.controlType);
}

export async function isEditableFocused(): Promise<boolean> {
  return isTypingTargetReady();
}

function isPaintForeground(
  processName?: string | null,
  windowTitle?: string | null,
): boolean {
  const proc = (processName ?? "").toLowerCase();
  const title = windowTitle ?? "";
  return proc === "mspaint" || /paint/i.test(title);
}

/**
 * Phase 1 — block until Paint is stable foreground (not Ripple/Cursor).
 * Paint canvas steps do not need an editable UIA field.
 */
export async function waitForPaintForeground(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const started = Date.now();
  let stableSince = 0;
  let lastHwnd: number | undefined;

  while (Date.now() - started < PAINT_FOCUS_MAX_WAIT_MS) {
    await restoreFocusContext();
    await delay(90);
    const obs = await captureObservation();
    const proc = obs.foreground?.processName ?? "";
    const title = obs.foreground?.windowTitle ?? "";

    if (isRippleApplicationWindow(proc, title)) {
      stableSince = 0;
      lastHwnd = undefined;
      await delay(120);
      continue;
    }

    if (!isPaintForeground(proc, title)) {
      stableSince = 0;
      lastHwnd = undefined;
      await delay(120);
      continue;
    }

    const hwnd = obs.foreground?.hwnd;
    if (hwnd && hwnd === lastHwnd) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= PAINT_FOCUS_STABLE_MS) {
        return { ok: true };
      }
    } else {
      lastHwnd = hwnd;
      stableSince = hwnd ? Date.now() : 0;
    }
    await delay(100);
  }

  const obs = await captureObservation();
  return {
    ok: false,
    reason: `paint_focus_timeout:${obs.foreground?.processName ?? "?"}`,
  };
}

/** P8.5 — verify foreground has an edit-like control before typing. */
export async function verifyInputFocusReady(options?: {
  settleMs?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const settleMs = options?.settleMs ?? 120;
  if (settleMs > 0) await delay(settleMs);

  if (await isTypingTargetReady()) {
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
export async function focusLockAfterAppLaunch(nextTool?: string): Promise<void> {
  if (isSaveDialogModalLocked()) return;

  if (nextTool && POST_LAUNCH_FILE_TOOLS.has(nextTool)) {
    await delay(ELECTRON_EDITOR_SETTLE_MS);
    await restoreFocusContext();
    await adoptForegroundAsTypingTarget();
    extendCommandFocusGrace(12_000);
    return;
  }

  await delay(LAUNCH_FOCUS_SETTLE_MS);
  await adoptForegroundAsTypingTarget();
  extendCommandFocusGrace(12_000);

  if (nextTool && PAINT_STEP_TOOLS.has(nextTool)) {
    const paint = await waitForPaintForeground();
    if (process.env.RIPPLE_P85_TRACE !== "0") {
      console.info(
        `[ripple-p85] focus-barrier paint ${paint.ok ? "ok" : paint.reason}`,
      );
    }
    return;
  }

  let check = await verifyInputFocusReady({ settleMs: 80 });
  if (check.ok) return;

  await restoreFocusContext();
  await delay(TYPE_PREFLIGHT_WAIT_MS);
  await adoptForegroundAsTypingTarget();

  const obs = await captureObservation();
  if (isClassicEditorProcess(obs.foreground?.processName)) {
    await ensureEditorKeyboardFocus();
  }

  check = await verifyInputFocusReady({ settleMs: 80 });

  if (process.env.RIPPLE_P85_TRACE !== "0" && !check.ok) {
    console.info(`[ripple-p85] focus-lock soft-continue ${check.reason}`);
  }
}

/** Safe typing gate — refocus before INSERT_TEXT when field is not editable. */
export async function safeTypingPreflight(): Promise<void> {
  if (isSaveDialogModalLocked()) return;
  if (await isTypingTargetReady()) return;

  await restoreFocusContext();
  await delay(TYPE_PREFLIGHT_WAIT_MS);
  await adoptForegroundAsTypingTarget();

  const obs = await captureObservation();
  if (isClassicEditorProcess(obs.foreground?.processName)) {
    await ensureEditorKeyboardFocus();
  }

  if (await isTypingTargetReady()) return;

  await delay(TYPE_PREFLIGHT_WAIT_MS);
  if (isClassicEditorProcess(obs.foreground?.processName)) {
    await ensureEditorKeyboardFocus();
  }
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
    POST_LAUNCH_FILE_TOOLS.has(nextTool)
  ) {
    await focusLockAfterAppLaunch(nextTool);
    return;
  }

  if (PAINT_STEP_TOOLS.has(nextTool)) {
    if (
      prevTool &&
      POST_LAUNCH_TOOLS.has(prevTool)
    ) {
      await focusLockAfterAppLaunch(nextTool);
    } else {
      const paint = await waitForPaintForeground();
      if (process.env.RIPPLE_P85_TRACE !== "0" && !paint.ok) {
        console.warn(`[ripple-p85] focus-barrier warn ${paint.reason}`);
      }
    }
    await delay(COMPOUND_STEP_GAP_MS);
    return;
  }

  if (
    prevTool &&
    POST_LAUNCH_TOOLS.has(prevTool) &&
    INPUT_READY_TOOLS.has(nextTool)
  ) {
    await focusLockAfterAppLaunch(nextTool);
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
export async function submitSaveDialog(
  fullPath: string,
  opts?: SaveFlowOptions,
): Promise<void> {
  await runSaveFileDialogFlow(fullPath, opts);
}
