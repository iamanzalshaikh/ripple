import {
  isDesktopShellForeground,
  isWeakFocusContext,
  restoreFocusContext,
  resolveTypingFocusTarget,
} from "../focus/focusContext.js";
import { isSaveDialogModalLocked, matchesMainDocumentA11y } from "../focus/saveDialogMode.js";
import {
  clickBrowserComposerNative,
  focusWindowByHwnd,
  getFocusedA11yElement,
  getForegroundWindow,
  getCursorPositionNative,
  getWindowUnderCursorNative,
  mouseClickNative,
  type ComposerClickResult,
} from "../native/win32Bridge.js";

const FOCUS_DRIFT_LOG = "[ripple-focus-drift]";

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

export function isBrowserProcess(processName: string): boolean {
  const p = (processName ?? "").toLowerCase();
  return (
    p === "chrome" ||
    p === "msedge" ||
    p.includes("firefox") ||
    p === "brave" ||
    p === "opera"
  );
}

function isOmniboxA11y(a11y: {
  name?: string;
  className?: string;
  automationId?: string;
} | null): boolean {
  if (!a11y) return false;
  const name = (a11y.name ?? "").toLowerCase();
  const cls = (a11y.className ?? "").toLowerCase();
  const aid = (a11y.automationId ?? "").toLowerCase();
  return (
    name.includes("address and search") ||
    cls.includes("omnibox") ||
    /^view_\d+$/.test(aid)
  );
}

function logComposerFocusDrift(
  kind: string,
  target: { processName: string; hwnd: number },
  result: ComposerClickResult | null,
  extra?: string,
): void {
  const parts = [
    kind,
    `target=${target.processName}`,
    `hwnd=${target.hwnd}`,
    result?.method ? `method=${result.method}` : null,
    result?.reason ? `reason=${result.reason}` : null,
    result?.x != null && result?.y != null
      ? `click=(${result.x},${result.y})`
      : null,
    result?.insideWin != null ? `insideWin=${result.insideWin}` : null,
    result?.pointOnTarget != null
      ? `pointOnTarget=${result.pointOnTarget}`
      : null,
    result?.underProc ? `underProc=${result.underProc}` : null,
    result?.underTitle
      ? `underTitle="${result.underTitle.slice(0, 40)}"`
      : null,
    result?.fgProc ? `fgProc=${result.fgProc}` : null,
    result?.fgTitle ? `fgTitle="${result.fgTitle.slice(0, 40)}"` : null,
    result?.winLeft != null
      ? `winRect=(${result.winLeft},${result.winTop})-(${result.winRight},${result.winBottom})`
      : null,
    extra ?? null,
  ].filter(Boolean);
  console.warn(`${FOCUS_DRIFT_LOG} ${parts.join(" ")}`);
}

/**
 * Focus the web chat/message composer via UIA (Google Chat, WhatsApp Web, …).
 * Prefer SetFocus; refuse physical clicks that would land outside the target HWND
 * (multi-monitor UIA coords have hit the desktop ListView / Program Manager).
 */
export async function ensureBrowserComposerFocus(): Promise<boolean> {
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd) return true;
  const browser =
    target.isBrowser === true || isBrowserProcess(target.processName);
  if (!browser) return true;

  const a11y = await getFocusedA11yElement();
  if (isEditLikeControl(a11y?.controlType) && !isOmniboxA11y(a11y)) {
    console.info(
      `[ripple-insert] composer_focus method=already_focused ok=1` +
        ` control=${a11y?.controlType ?? "?"} target=${target.processName}`,
    );
    return true;
  }

  const result = await clickBrowserComposerNative({ hwnd: target.hwnd });
  if (result?.ok) {
    console.info(
      `[ripple-insert] composer_focus method=${result.method ?? "?"} ok=1` +
        ` target=${target.processName} (${result.x ?? "?"},${result.y ?? "?"})` +
        ` name="${(result.name ?? "").slice(0, 40)}"`,
    );
    await new Promise((r) => setTimeout(r, 220));

    const fg = await getForegroundWindow();
    if (fg && isDesktopShellForeground(fg)) {
      logComposerFocusDrift("composer_left_shell_after_focus", target, {
        ...result,
        fgProc: fg.processName,
        fgTitle: fg.windowTitle,
      });
      await restoreFocusContext();
      return false;
    }

    const after = await getFocusedA11yElement();
    if (
      after?.controlType?.toLowerCase().includes("listitem") &&
      (fg?.processName ?? "").toLowerCase() === "explorer"
    ) {
      logComposerFocusDrift(
        "composer_focus_desktop_listitem",
        target,
        result,
        `a11y="${(after.name ?? "").slice(0, 40)}"`,
      );
      await restoreFocusContext();
      return false;
    }

    return true;
  }

  if (
    result?.reason === "point_outside_hwnd" ||
    result?.reason === "clicked_shell"
  ) {
    logComposerFocusDrift("composer_click_refused_or_shell", target, result);
  } else {
    console.warn(
      `[ripple-desktop] composer click missed — ${result?.reason ?? "unknown"} (hwnd=${target.hwnd})`,
    );
  }
  console.warn(
    `[ripple-insert] composer_focus method=${result?.method ?? "none"} ok=0` +
      ` reason=${result?.reason ?? "unknown"} target=${target.processName}`,
  );
  return false;
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
  const { getWindowRectCenter } = await import("../native/win32Bridge.js");
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
  /** Skip mouse click — hwnd activate only (copy/cut/select-all). */
  clipboardOp?: boolean;
}): Promise<void> {
  if (isSaveDialogModalLocked()) return;

  const target = resolveTypingFocusTarget();
  if (!target?.hwnd || isWeakFocusContext(target)) return;

  if (opts?.clipboardOp && isClassicTextEditorProcess(target.processName)) {
    const fg = await getForegroundWindow();
    const fgOnTarget =
      hwndMatches(fg?.hwnd, target.hwnd) ||
      (fg?.processName ?? "").toLowerCase() ===
        (target.processName ?? "").toLowerCase();
    if (!fgOnTarget) {
      await restoreFocusContext();
    }
    await focusWindowByHwnd(target.hwnd, target.windowTitle);
    await new Promise((r) => setTimeout(r, 500));
    const a11y = await getFocusedA11yElement();
    if (!a11y || !matchesMainDocumentA11y(a11y)) {
      await clickEditorBody(target);
    }
    return;
  }

  // Clipboard paste path: restore FG only on mismatch; only re-target composer
  // if not already in edit. Avoids a second physical click after
  // prepareDictationInsertFocus (shell-steal risk) and skips redundant restores
  // when assertInsertForeground already confirmed chrome is FG.
  if (
    opts?.clipboardOp &&
    (target.isBrowser || isBrowserProcess(target.processName))
  ) {
    const fg = await getForegroundWindow();
    const onTarget = Boolean(fg?.hwnd) && hwndMatches(fg?.hwnd, target.hwnd);
    if (!onTarget) {
      await restoreFocusContext();
      await new Promise((r) => setTimeout(r, 180));
      // A real Focus-Hwnd ritual can leave Chrome in Alt-menu mnemonic mode
      // where the next Ctrl+V is swallowed; ESC exits that mode (verified
      // live 2026-08-14). Only after an actual restore — never on the
      // fast path, and never for non-browser targets (Save dialogs!).
      try {
        const { sendKeyChord } = await import("../automation/keyboard.js");
        await sendKeyChord("{ESC}");
        await new Promise((r) => setTimeout(r, 90));
        console.info(
          "[ripple-insert] altmenu_neutralized target=browser (post-restore ESC)",
        );
      } catch {
        /* best-effort */
      }
    }
    // Caret placement ALWAYS runs before a browser clipboard paste — even on
    // the fg-match fast path. ensureBrowserComposerFocus does its own cheap
    // already-focused check (logged composer_focus method=already_focused),
    // so skipping it here only ever skipped the log + the SetFocus safety.
    await ensureBrowserComposerFocus();
    return;
  }

  await restoreFocusContext();

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
      : isBrowserProcess(target.processName) || target.isBrowser
        ? false
        : !inEditField;

  if (
    (target.isBrowser || isBrowserProcess(target.processName)) &&
    !inEditField
  ) {
    await ensureBrowserComposerFocus();
    return;
  }

  if (!needsCenterClick) return;

  await clickEditorBody(target);
}
