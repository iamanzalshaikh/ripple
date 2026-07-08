import {
  isWeakFocusContext,
  resolveTypingFocusTarget,
  restoreFocusContext,
} from "../focus/focusContext.js";
import { isClassicTextEditorProcess } from "./editorFocus.js";
import {
  focusWindowByHwnd,
  getForegroundWindow,
  getWindowRectCenter,
  mouseClickNative,
} from "../native/win32Bridge.js";

const FOCUS_RETRY_MS = 300;
const NOTEPAD_ACTIVATE_MS = 500;
const SELECT_ALL_SETTLE_MS = 150;
const CLIPBOARD_SETTLE_MS = 300;

function hwndMatchesTarget(
  fgHwnd: number | undefined,
  targetHwnd: number | undefined,
): boolean {
  return Boolean(fgHwnd && targetHwnd && Number(fgHwnd) === Number(targetHwnd));
}

function processMatchesTarget(
  fgProcess: string | undefined,
  targetProcess: string | undefined,
): boolean {
  const fg = (fgProcess ?? "").toLowerCase();
  const target = (targetProcess ?? "").toLowerCase();
  return Boolean(fg && target && fg === target);
}

/** Fail fast when OS test lock is violated (e.g. Cursor steals focus during Notepad test). */
export async function assertOsTestLockNotViolated(): Promise<void> {
  const lock = process.env.OS_TEST_LOCK_WINDOW?.trim().toLowerCase();
  if (!lock) return;

  const fg = await getForegroundWindow();
  const proc = (fg?.processName ?? "").toLowerCase();

  if (lock === "notepad") {
    if (proc.includes("cursor")) {
      throw new Error(
        "OS_TEST_LOCK_WINDOW violation: Cursor has foreground during notepad test",
      );
    }
    if (proc === "electron" && (fg?.windowTitle ?? "").toLowerCase().includes("ripple")) {
      throw new Error(
        "OS_TEST_LOCK_WINDOW violation: Ripple has foreground during notepad test",
      );
    }
  }
}

/**
 * Hard focus barrier — foreground must match expected target before keys are sent.
 * Retries focus up to `maxRetries` with 300ms settle between attempts.
 */
export async function ensureHardFocusBarrier(maxRetries = 3): Promise<void> {
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd || isWeakFocusContext(target)) return;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await assertOsTestLockNotViolated();

    const fg = await getForegroundWindow();
    if (
      hwndMatchesTarget(fg?.hwnd, target.hwnd) ||
      processMatchesTarget(fg?.processName, target.processName)
    ) {
      return;
    }

    await restoreFocusContext();
    await focusWindowByHwnd(target.hwnd, target.windowTitle);
    await new Promise((r) => setTimeout(r, FOCUS_RETRY_MS));

    const fgAfter = await getForegroundWindow();
    if (
      hwndMatchesTarget(fgAfter?.hwnd, target.hwnd) ||
      processMatchesTarget(fgAfter?.processName, target.processName)
    ) {
      return;
    }
  }

  const fg = await getForegroundWindow();
  throw new Error(
    `Focus barrier failed after ${maxRetries} retries — expected ${target.processName} ("${target.windowTitle.slice(0, 40)}"), got ${fg?.processName ?? "?"} ("${(fg?.windowTitle ?? "").slice(0, 40)}")`,
  );
}

/** Activate classic editor HWND and wait — no mouse click. */
export async function activateClassicEditorHwnd(): Promise<{
  hwnd: number;
  titleHint: string;
}> {
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd) {
    throw new Error("No editor window to activate for clipboard operation");
  }

  await assertOsTestLockNotViolated();
  await ensureHardFocusBarrier(3);
  await focusWindowByHwnd(target.hwnd, target.windowTitle);
  await new Promise((r) => setTimeout(r, NOTEPAD_ACTIVATE_MS));
  await assertOsTestLockNotViolated();

  const fg = await getForegroundWindow();
  if (
    !hwndMatchesTarget(fg?.hwnd, target.hwnd) &&
    !processMatchesTarget(fg?.processName, target.processName)
  ) {
    throw new Error(
      `Editor activation failed — foreground is ${fg?.processName ?? "?"} not ${target.processName}`,
    );
  }

  return { hwnd: target.hwnd, titleHint: target.windowTitle };
}

/** Last-resort caret placement when hwnd-only activation fails. */
export async function clickClassicEditorBody(): Promise<void> {
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd) return;
  const center = await getWindowRectCenter(target.hwnd);
  if (!center) return;
  const clickY = Math.round(center.y + 55);
  const clicked = await mouseClickNative({
    x: center.x,
    y: clickY,
    button: "left",
  });
  if (clicked?.ok) {
    console.info(
      `[ripple-desktop] editor click (clipboard fallback) → ${target.processName} (${center.x},${clickY})`,
    );
  }
  await new Promise((r) => setTimeout(r, 200));
}

export function isClassicEditorClipboardTarget(): boolean {
  const target = resolveTypingFocusTarget();
  return Boolean(
    target?.hwnd && isClassicTextEditorProcess(target.processName ?? ""),
  );
}

export const clipboardTiming = {
  selectAllSettleMs: SELECT_ALL_SETTLE_MS,
  clipboardSettleMs: CLIPBOARD_SETTLE_MS,
};
