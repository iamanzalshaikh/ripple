import {
  isWeakFocusContext,
  restoreFocusContext,
  resolveTypingFocusTarget,
} from "../focus/focusContext.js";
import { isSaveDialogModalLocked } from "../focus/saveDialogMode.js";
import {
  getFocusedA11yElement,
  getForegroundWindow,
  getCursorPositionNative,
  getWindowRectCenter,
  getWindowUnderCursorNative,
  mouseClickNative,
} from "../native/win32Bridge.js";

function isEditLikeControl(controlType?: string): boolean {
  const c = (controlType ?? "").toLowerCase();
  return (
    c.includes("edit") ||
    c.includes("document") ||
    c.includes("text") ||
    c.includes("code")
  );
}

const NAV_KEY_RE = /^\{(UP|DOWN|LEFT|RIGHT|HOME|END|PGUP|PGDN)\}$/i;

function isNavigationInput(opts?: {
  keys?: string;
  steps?: Array<{ value: string }>;
}): boolean {
  if (opts?.keys?.trim() && NAV_KEY_RE.test(opts.keys.trim())) return true;
  if (
    opts?.steps?.length &&
    opts.steps.every((s) => NAV_KEY_RE.test(s.value.trim()))
  ) {
    return true;
  }
  return false;
}

/** Electron IDE top-level HWND is not the keyboard target — skip native focus_hwnd. */
export function isElectronEditorProcess(processName: string): boolean {
  const p = (processName ?? "").toLowerCase();
  return (
    p === "cursor" ||
    p.includes("code") ||
    p === "electron" ||
    p.includes("vscode") ||
    p.includes("sublime") ||
    p.includes("notepad++")
  );
}

/** Win11/classic editors — parent HWND focus is not enough; click document body. */
export function isClassicTextEditorProcess(processName: string): boolean {
  const p = (processName ?? "").toLowerCase();
  return p === "notepad" || p.includes("wordpad") || p.includes("mspaint");
}

function editorClickOffsetY(processName: string): number {
  if (isClassicTextEditorProcess(processName)) return 55;
  return 80;
}

function hwndMatches(
  a: number | undefined,
  b: number | undefined,
): boolean {
  return Boolean(a && b && Number(a) === Number(b));
}

async function clickEditorBody(
  target: NonNullable<ReturnType<typeof resolveTypingFocusTarget>>,
): Promise<void> {
  const center = await getWindowRectCenter(target.hwnd);
  if (!center) return;
  const clickY = Math.round(center.y + editorClickOffsetY(target.processName));
  const clicked = await mouseClickNative({
    x: center.x,
    y: clickY,
    button: "left",
  });
  if (clicked?.ok) {
    console.info(
      `[ripple-desktop] editor click → ${target.processName} (${center.x},${clickY})`,
    );
  }
  await new Promise((r) => setTimeout(r, 200));
}

/**
 * Restore target window and place keyboard focus in the text field.
 * Navigation keys (arrows/home/end): hybrid — keep caret if already in editor;
 * else click where the mouse is when it is over the voice target.
 */
export async function ensureEditorKeyboardFocus(opts?: {
  keys?: string;
  steps?: Array<{ value: string }>;
}): Promise<void> {
  if (isSaveDialogModalLocked()) return;

  await restoreFocusContext();
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd || isWeakFocusContext(target)) return;

  const isNav = isNavigationInput(opts);
  const settleMs = isClassicTextEditorProcess(target.processName) ? 380 : 220;
  await new Promise((r) => setTimeout(r, settleMs));

  const [a11y, fg, cursorPos, underMouse] = await Promise.all([
    getFocusedA11yElement(),
    getForegroundWindow(),
    getCursorPositionNative(),
    getWindowUnderCursorNative(),
  ]);

  const fgOnTarget = hwndMatches(fg?.hwnd, target.hwnd);
  const inEditField = isEditLikeControl(a11y?.controlType);

  if (isNav && fgOnTarget && inEditField) {
    console.info(
      `[ripple-desktop] caret focus skip (already in editor) → ${target.processName}`,
    );
    return;
  }

  if (isNav && cursorPos && hwndMatches(underMouse?.hwnd, target.hwnd)) {
    const clicked = await mouseClickNative({
      x: cursorPos.x,
      y: cursorPos.y,
      button: "left",
    });
    if (clicked?.ok) {
      console.info(
        `[ripple-desktop] caret focus (mouse hybrid) → ${target.processName} (${cursorPos.x},${cursorPos.y})`,
      );
      await new Promise((r) => setTimeout(r, 150));
      return;
    }
  }

  const needsCenterClick = isClassicTextEditorProcess(target.processName)
    ? true
    : isElectronEditorProcess(target.processName)
      ? !inEditField
      : !inEditField;

  if (!needsCenterClick) return;

  await clickEditorBody(target);
}
