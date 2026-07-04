import { existsSync } from "node:fs";
import type { ForegroundWindow } from "../native/types.js";
import { delay } from "../automation/delay.js";
import {
  isClassicTextEditorProcess,
} from "../agent/editorFocus.js";
import {
  adoptSaveDialogTarget,
  restoreFocusContext,
} from "./focusContext.js";
import {
  focusWindowByHwnd,
  getFocusedA11yElement,
  getForegroundWindow,
  getWindowRectCenter,
  listVisibleWindowsNative,
  mouseClickNative,
  sendKeysNative,
} from "../native/win32Bridge.js";
import { resolveTypingFocusTarget } from "./focusContext.js";

/** Win32 modal titles: "Save As", "Save as", localized variants. */
export function isSaveDialogTitle(title?: string | null): boolean {
  const t = (title ?? "").trim().toLowerCase();
  if (!t) return false;
  if (/\bsaved\b/.test(t)) return false;
  return (
    /\bsave\s*as\b/.test(t) ||
    t === "save" ||
    /^\s*save\s+\w/.test(t)
  );
}

export function isSaveDialogContext(
  ctx: { windowTitle?: string | null },
): boolean {
  return isSaveDialogTitle(ctx.windowTitle);
}

let saveDialogModeUntil = 0;

export function enterSaveDialogMode(ms = 20_000): void {
  saveDialogModeUntil = Date.now() + ms;
}

export function exitSaveDialogMode(): void {
  saveDialogModeUntil = 0;
}

export function isSaveDialogModeActive(): boolean {
  return saveDialogModeUntil > Date.now();
}

/** True only after Save As UI is visible — blocks Notepad refocus. */
let saveDialogModalLocked = false;

export function lockSaveDialogModal(): void {
  saveDialogModalLocked = true;
}

export function unlockSaveDialogModal(): void {
  saveDialogModalLocked = false;
}

export function isSaveDialogModalLocked(): boolean {
  return saveDialogModalLocked;
}

function nativeTargetArgs(): { hwnd?: number; titleHint?: string } {
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd) return {};
  return { hwnd: target.hwnd, titleHint: target.windowTitle };
}

/** UIA: Win11 file picker / classic Save As filename field. */
export async function isSaveFilenameFieldFocused(): Promise<boolean> {
  const el = await getFocusedA11yElement();
  if (!el) return false;
  const name = (el.name ?? "").toLowerCase();
  const type = (el.controlType ?? "").toLowerCase();
  if (/file\s*name|filename|name\s*field/.test(name)) return true;
  if (
    (type.includes("combobox") || type.includes("edit")) &&
    /file|name|save/.test(name)
  ) {
    return true;
  }
  return false;
}

/** Scan visible HWNDs — Save dialog is often a child #32770, not foreground. */
export async function findSaveDialogWindow(): Promise<ForegroundWindow | null> {
  const fg = await getForegroundWindow();
  if (fg?.hwnd && isSaveDialogTitle(fg.windowTitle)) {
    return fg;
  }

  const windows = await listVisibleWindowsNative();
  for (const w of windows) {
    if (!w.hwnd) continue;
    if (isSaveDialogTitle(w.windowTitle)) {
      return {
        hwnd: w.hwnd,
        processName: w.processName,
        windowTitle: w.windowTitle,
      };
    }
    const cls = (w.className ?? "").toLowerCase();
    if (cls === "#32770" && /\bsave/i.test(w.windowTitle ?? "")) {
      return {
        hwnd: w.hwnd,
        processName: w.processName,
        windowTitle: w.windowTitle,
      };
    }
  }
  return null;
}

export async function isSaveDialogReady(): Promise<boolean> {
  if (await findSaveDialogWindow()) return true;
  return isSaveFilenameFieldFocused();
}

export async function waitForSaveDialogWindow(
  timeoutMs = 7000,
): Promise<ForegroundWindow> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const dialog = await findSaveDialogWindow();
    if (dialog?.hwnd) return dialog;
    if (await isSaveFilenameFieldFocused()) {
      const fg = await getForegroundWindow();
      if (fg?.hwnd) return fg;
    }
    await delay(120);
  }
  const fg = await getForegroundWindow();
  throw new Error(
    `Save As dialog did not appear — foreground is "${fg?.windowTitle?.slice(0, 40) ?? "?"}"`,
  );
}

export async function focusSaveDialogHwnd(
  dialog: ForegroundWindow,
): Promise<void> {
  if (isSaveDialogTitle(dialog.windowTitle)) {
    await focusWindowByHwnd(Number(dialog.hwnd), dialog.windowTitle ?? "Save As");
    await delay(200);
  }
}

export async function waitForSaveDialogClose(timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await isSaveDialogReady())) return;
    await delay(120);
  }
}

async function sendKeysToEditor(keys: string): Promise<boolean> {
  const result = await sendKeysNative({
    ...nativeTargetArgs(),
    keys,
    delayMs: 100,
  });
  return Boolean(result?.ok);
}

async function focusEditorForSaveChord(): Promise<void> {
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd) {
    await restoreFocusContext();
  }
  const editor = resolveTypingFocusTarget();
  if (!editor?.hwnd) return;

  await focusWindowByHwnd(editor.hwnd, editor.windowTitle);
  await delay(350);

  if (isClassicTextEditorProcess(editor.processName)) {
    const center = await getWindowRectCenter(editor.hwnd);
    if (center) {
      const clickY = Math.round(center.y + 55);
      const clicked = await mouseClickNative({
        x: center.x,
        y: clickY,
        button: "left",
      });
      if (clicked?.ok) {
        console.info(
          `[ripple-desktop] save-prefocus click → ${editor.processName} (${center.x},${clickY})`,
        );
      }
      await delay(200);
    }
  }
}

/** Focus editor, then Ctrl+S / Ctrl+Shift+S / File→Save As until modal appears. */
export async function triggerSaveAsDialog(): Promise<void> {
  await focusEditorForSaveChord();

  const chords = ["^s", "^+s", "{F12}"];
  for (const keys of chords) {
    const ok = await sendKeysToEditor(keys);
    if (!ok) continue;
    console.info(`[ripple-desktop] save trigger sent: ${keys}`);
    await delay(900);
    if (await isSaveDialogReady()) return;
  }

  const okMenu = await sendKeysToEditor("%f");
  if (okMenu) {
    await delay(300);
    const menuOk = await sendKeysNative({ ...nativeTargetArgs(), keys: "a", delayMs: 80 });
    if (menuOk?.ok) {
      console.info("[ripple-desktop] save trigger sent: Alt+F,A");
      await delay(900);
      if (await isSaveDialogReady()) return;
    }
  }

  throw new Error(
    "Save As dialog did not open after Ctrl+S / Ctrl+Shift+S / menu fallback",
  );
}

/** Win11 may keep Notepad foreground — try paste+Enter after Ctrl+S anyway. */
export async function tryOptimisticSaveFill(fullPath: string): Promise<boolean> {
  const fg = await getForegroundWindow();
  const proc = (fg?.processName ?? "").toLowerCase();
  if (proc !== "notepad") return false;

  console.info("[ripple-desktop] save optimistic fill (Win11 in-window picker)");
  try {
    await fillSaveDialogPath(fullPath);
    await delay(400);
    return existsSync(fullPath);
  } catch {
    return false;
  }
}

async function fillSaveDialogPath(fullPath: string): Promise<void> {
  const { clipboard } = await import("electron");
  clipboard.writeText(fullPath);
  await delay(80);

  let result = await sendKeysNative({ keys: "%n", delayMs: 60 });
  void result;
  await delay(80);

  result = await sendKeysNative({ keys: "^a", delayMs: 60 });
  if (!result?.ok) {
    throw new Error(
      `Save dialog filename field not ready — fg="${result?.foregroundTitle?.slice(0, 40) ?? "?"}"`,
    );
  }
  await delay(60);
  result = await sendKeysNative({ keys: "^v", delayMs: 80 });
  if (!result?.ok) {
    throw new Error("Could not paste path into Save dialog");
  }
  await delay(120);
  result = await sendKeysNative({ keys: "{ENTER}", delayMs: 100 });
  if (!result?.ok) {
    throw new Error("Could not confirm Save dialog");
  }
}

/**
 * Full Notepad/classic-editor save flow:
 * focus → Ctrl+S → wait modal → paste path → Enter → verify file.
 */
export async function runSaveFileDialogFlow(fullPath: string): Promise<void> {
  try {
    try {
      await triggerSaveAsDialog();
    } catch (triggerErr) {
      if (await tryOptimisticSaveFill(fullPath)) {
        console.info(`[ripple-desktop] save verified (optimistic) → ${fullPath}`);
        return;
      }
      throw triggerErr;
    }

    enterSaveDialogMode();
    lockSaveDialogModal();

    const dialog = await waitForSaveDialogWindow();
    await focusSaveDialogHwnd(dialog);
    adoptSaveDialogTarget(dialog);
    await delay(150);

    await fillSaveDialogPath(fullPath);

    await waitForSaveDialogClose();
    await delay(250);
    if (!existsSync(fullPath)) {
      throw new Error(`Save verification failed — file not found: ${fullPath}`);
    }
    console.info(`[ripple-desktop] save verified → ${fullPath}`);
  } finally {
    unlockSaveDialogModal();
    exitSaveDialogMode();
  }
}
