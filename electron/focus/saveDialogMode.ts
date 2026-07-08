import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { A11yFocusedElement, ForegroundWindow } from "../native/types.js";
import { delay } from "../automation/delay.js";
import {
  isClassicTextEditorProcess,
} from "../agent/editorFocus.js";
import {
  adoptSaveDialogTarget,
  extendCommandFocusGrace,
  restoreFocusContext,
} from "./focusContext.js";
import {
  clickUiaInWindowNative,
  focusWindowByHwnd,
  getFocusedA11yElement,
  getForegroundWindow,
  getWindowRectCenter,
  closeWindowByHwnd,
  getPrimaryScreenCenter,
  listVisibleWindowsNative,
  mouseClickNative,
  sendKeysNative,
} from "../native/win32Bridge.js";
import { resolveTypingFocusTarget } from "./focusContext.js";

export type SaveFlowOptions = {
  /** Recovery retry — dismiss partial UI, no second Ctrl+S if dialog still open. */
  recoveryAttempt?: boolean;
};

let saveChordSentThisFlow = false;
const SAVE_CHORD_WAIT_MS = 2_000;
const SAVE_VERIFY_MAX_AGE_MS = 20_000;
const INLINE_FOLDER_POLL_MS = 100;
const INLINE_FOLDER_POLL_TIMEOUT_MS = 3_000;

/** Win11 inline bar | classic #32770 modal | none */
export type SaveUiKind = "classic_dialog" | "inline_bar" | "none";

export type SaveUiState = {
  kind: Exclude<SaveUiKind, "none">;
  target?: ForegroundWindow;
};

export type SavePathParts = {
  dir: string;
  filename: string;
  fullPath: string;
};

/** Overwrite prompt — not the file picker (must not match isSaveDialogTitle). */
export function isConfirmSaveAsTitle(title?: string | null): boolean {
  return /^\s*confirm\s+save\s+as\b/i.test((title ?? "").trim());
}

/** Win32 modal titles: "Save As", "Save as", localized variants. */
export function isSaveDialogTitle(title?: string | null): boolean {
  const raw = (title ?? "").trim();
  if (!raw) return false;
  if (isConfirmSaveAsTitle(raw)) return false;
  const t = raw.toLowerCase();
  if (/\bsaved\b/.test(t)) return false;
  return (
    /\bsave\s*as\b/.test(t) ||
    t === "save" ||
    /^\s*save\s+\w/.test(t)
  );
}

/** Close stray Notepad windows, keeping the one with an open Save As UI. */
export async function dismissExtraNotepadInstances(): Promise<number> {
  const windows = await listVisibleWindowsNative();
  const notepads = windows.filter(
    (w) => w.hwnd && (w.processName ?? "").toLowerCase() === "notepad",
  );
  if (notepads.length <= 1) return 0;

  const saveUi = await detectSaveUi();
  let keepHwnd = saveUi.kind !== "none" ? saveUi.target?.hwnd : undefined;
  if (!keepHwnd) {
    keepHwnd =
      notepads.find(
        (w) =>
          isSaveDialogTitle(w.windowTitle) ||
          isConfirmSaveAsTitle(w.windowTitle),
      )?.hwnd ?? notepads[0]?.hwnd;
  }

  let closed = 0;
  for (const w of notepads) {
    if (!w.hwnd || w.hwnd === keepHwnd) continue;
    try {
      await closeWindowByHwnd(w.hwnd);
      closed++;
      await delay(200);
    } catch (e: unknown) {
      console.warn(
        `[ripple-desktop] failed to close extra Notepad hwnd=${w.hwnd}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (closed > 0) {
    console.info(`[ripple-desktop] dismissed ${closed} extra Notepad instance(s)`);
    const keep = notepads.find((w) => w.hwnd === keepHwnd);
    if (keep?.hwnd) {
      await focusWindowByHwnd(keep.hwnd, keep.windowTitle);
      await delay(300);
    }
  }
  return closed;
}

/** Dismiss "Confirm Save As" overwrite prompt (Yes). */
export async function dismissConfirmSaveAsOverwriteIfOpen(): Promise<boolean> {
  let fg = await getForegroundWindow();
  if (!fg || !isConfirmSaveAsTitle(fg.windowTitle)) {
    const windows = await listVisibleWindowsNative();
    const confirm = windows.find((w) => isConfirmSaveAsTitle(w.windowTitle));
    if (confirm?.hwnd) {
      await focusWindowByHwnd(confirm.hwnd, confirm.windowTitle);
      await delay(200);
      fg = await getForegroundWindow();
    }
  }
  if (!fg || !isConfirmSaveAsTitle(fg.windowTitle)) return false;

  const before = fg.windowTitle ?? "";
  console.info("[ripple-desktop] overwrite confirm → Enter (Yes)");
  await sendKeysToForeground("{ENTER}");
  await delay(500);
  const after = await getForegroundWindow();
  const dismissed = !isConfirmSaveAsTitle(after?.windowTitle);
  if (!dismissed) {
    console.warn(
      `[ripple-desktop] overwrite confirm still open after Enter — "${(after?.windowTitle ?? "").slice(0, 40)}"`,
    );
    return false;
  }
  console.info(`[ripple-desktop] overwrite confirm dismissed (was "${before.slice(0, 30)}")`);
  return true;
}

export function isSaveDialogContext(
  ctx: { windowTitle?: string | null },
): boolean {
  return isSaveDialogTitle(ctx.windowTitle);
}

/** True when editor title indicates no path on disk yet (e.g. "Untitled - Notepad"). */
export function isUntitledEditorTitle(title?: string | null): boolean {
  const t = (title ?? "").trim();
  if (!t) return true;
  if (/untitled/i.test(t)) return true;
  return !/\.\w{1,8}\s*[-–—|]/i.test(t);
}

/** Basename from "user.txt - Notepad" / "*draft.txt - Notepad". */
export function extractBasenameFromEditorTitle(title?: string | null): string | null {
  const t = (title ?? "").trim();
  if (!t || isUntitledEditorTitle(t)) return null;
  const m = t.match(/^[*]?(.*?)\s*[-–—|]\s*\w/i);
  const name = (m?.[1] ?? t).trim();
  return name || null;
}

/** Silent Ctrl+S only when the open document IS the save target (same basename). */
export function shouldUseSilentSave(
  editorTitle: string | null | undefined,
  targetFullPath: string,
): boolean {
  const openBase = extractBasenameFromEditorTitle(editorTitle);
  if (!openBase) return false;
  return openBase.toLowerCase() === basename(targetFullPath).toLowerCase();
}

export function splitSavePath(fullPath: string): SavePathParts {
  const full = fullPath.trim();
  return {
    dir: dirname(full),
    filename: basename(full),
    fullPath: full,
  };
}

/** UIA heuristics for filename field — classic dialog + Win11 inline picker. */
export function matchesSaveFilenameA11y(el: A11yFocusedElement): boolean {
  const name = (el.name ?? "").toLowerCase();
  const type = (el.controlType ?? "").toLowerCase();
  const autoId = (el.automationId ?? "").toLowerCase();

  if (/file\s*name|filename|name\s*field|enter\s*a\s*file|file\s*name:/.test(name)) {
    return true;
  }
  if (/filename|file_name|filenametextbox|file\s*name\s*box|1001/.test(autoId)) {
    return true;
  }
  if (
    (type.includes("combobox") || type.includes("edit") || type.includes("text")) &&
    /file|name/.test(name) &&
    !/location|folder|path/.test(name)
  ) {
    return true;
  }
  return false;
}

/** Main document / text area — must NOT receive save path paste. */
export function matchesMainDocumentA11y(el: A11yFocusedElement): boolean {
  if (matchesSaveFilenameA11y(el) || matchesSaveLocationA11y(el)) {
    return false;
  }
  const name = (el.name ?? "").toLowerCase();
  const type = (el.controlType ?? "").toLowerCase();
  return (
    /text\s*editor/.test(name) ||
    type.includes("document") ||
    (type.includes("edit") && !/file|name|save|location|folder/.test(name))
  );
}

/** Folder / location field in save UI. */
export function matchesSaveLocationA11y(el: A11yFocusedElement): boolean {
  const name = (el.name ?? "").toLowerCase();
  const type = (el.controlType ?? "").toLowerCase();
  const autoId = (el.automationId ?? "").toLowerCase();
  if (/location|folder|save\s*in|where/.test(name)) return true;
  if (/location|folder|address|breadcrumb/.test(autoId)) return true;
  if (
    (type.includes("combobox") || type.includes("edit")) &&
    /location|folder|path|save\s*in/.test(name)
  ) {
    return true;
  }
  return false;
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

/** Keys to foreground focus — never route through editor HWND during save fill. */
async function sendKeysToForeground(
  keys: string,
  delayMs = 80,
): Promise<boolean> {
  const result = await sendKeysNative({ keys, delayMs });
  return Boolean(result?.ok);
}

async function pasteTextToForeground(text: string): Promise<boolean> {
  const result = await sendKeysNative({ text, delayMs: 40 });
  return Boolean(result?.ok);
}

function resolveSaveTargetHwnd(
  ui: SaveUiState,
  fg?: ForegroundWindow | null,
): number | undefined {
  const foreground = fg ?? null;
  if (foreground?.hwnd) {
    const proc = (foreground.processName ?? "").toLowerCase();
    if (proc === "notepad" || isSaveDialogTitle(foreground.windowTitle)) {
      return foreground.hwnd;
    }
  }
  return ui.target?.hwnd;
}

/** Route keys/text to the Save As HWND (not whatever stole foreground). */
async function sendKeysToSaveTarget(
  ui: SaveUiState,
  spec: { keys?: string; text?: string; delayMs?: number },
): Promise<boolean> {
  await refocusInlineSaveUi(ui);
  const fg = await getForegroundWindow();
  let hwnd = resolveSaveTargetHwnd(ui, fg);
  if (!hwnd && ui.kind === "classic_dialog") {
    hwnd = (await findSaveDialogWindow())?.hwnd;
  }
  const result = await sendKeysNative({
    hwnd,
    titleHint: fg?.windowTitle ?? ui.target?.windowTitle ?? "Save as",
    keys: spec.keys,
    text: spec.text,
    delayMs: spec.delayMs ?? 80,
  });
  return Boolean(result?.ok);
}

/** UIA: Win11 file picker / classic Save As filename field. */
export async function isSaveFilenameFieldFocused(): Promise<boolean> {
  const el = await getFocusedA11yElement();
  if (!el) return false;
  return matchesSaveFilenameA11y(el);
}

/** Win11 Notepad embeds Save As inside the app window — not a #32770 modal. */
function isWin11NotepadEmbeddedSave(win: {
  processName?: string | null;
  windowTitle?: string | null;
}): boolean {
  return (
    (win.processName ?? "").toLowerCase() === "notepad" &&
    isSaveDialogTitle(win.windowTitle)
  );
}

export async function findSaveDialogWindow(): Promise<ForegroundWindow | null> {
  const fg = await getForegroundWindow();
  if (fg?.hwnd && isSaveDialogTitle(fg.windowTitle)) {
    if (!isWin11NotepadEmbeddedSave(fg)) {
      return fg;
    }
  }

  const windows = await listVisibleWindowsNative();
  for (const w of windows) {
    if (!w.hwnd) continue;
    if (isWin11NotepadEmbeddedSave(w)) continue;
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

/** Detect classic modal OR Win11 inline save bar (UI visible, not necessarily filename-ready). */
export async function detectSaveUi(): Promise<SaveUiState | { kind: "none" }> {
  const windows = await listVisibleWindowsNative();
  const notepadSave = windows.find(
    (w) =>
      w.hwnd &&
      (w.processName ?? "").toLowerCase() === "notepad" &&
      (isSaveDialogTitle(w.windowTitle) ||
        isConfirmSaveAsTitle(w.windowTitle)),
  );
  if (notepadSave?.hwnd) {
    if (isConfirmSaveAsTitle(notepadSave.windowTitle)) {
      return { kind: "inline_bar", target: {
        hwnd: notepadSave.hwnd,
        processName: notepadSave.processName,
        windowTitle: notepadSave.windowTitle,
      } };
    }
    return { kind: "inline_bar", target: {
      hwnd: notepadSave.hwnd,
      processName: notepadSave.processName,
      windowTitle: notepadSave.windowTitle,
    } };
  }

  const fgNotepad = windows.find(
    (w) =>
      w.hwnd && (w.processName ?? "").toLowerCase() === "notepad",
  );
  if (fgNotepad?.hwnd) {
    const fg = await getForegroundWindow();
    const el = await getFocusedA11yElement();
    if (
      el &&
      (matchesSaveFilenameA11y(el) ||
        matchesSaveLocationA11y(el) ||
        (!matchesMainDocumentA11y(el) &&
          (el.controlType ?? "").toLowerCase().match(/combobox|edit|list|tree/)))
    ) {
      return {
        kind: "inline_bar",
        target: fg?.hwnd ? fg : {
          hwnd: fgNotepad.hwnd,
          processName: fgNotepad.processName,
          windowTitle: fgNotepad.windowTitle,
        },
      };
    }
  }

  const fgEarly = await getForegroundWindow();
  if (fgEarly && isWin11NotepadEmbeddedSave(fgEarly)) {
    return { kind: "inline_bar", target: fgEarly };
  }

  const classic = await findSaveDialogWindow();
  if (classic?.hwnd) {
    return { kind: "classic_dialog", target: classic };
  }

  const fg = await getForegroundWindow();
  const proc = (fg?.processName ?? "").toLowerCase();
  if (proc !== "notepad") {
    return { kind: "none" };
  }

  const el = await getFocusedA11yElement();
  if (!el) {
    return { kind: "none" };
  }

  if (
    matchesSaveFilenameA11y(el) ||
    matchesSaveLocationA11y(el) ||
    (!matchesMainDocumentA11y(el) &&
      (el.controlType ?? "").toLowerCase().match(/combobox|edit/))
  ) {
    return { kind: "inline_bar", target: fg ?? undefined };
  }

  return { kind: "none" };
}

/** True only when filename field (not folder bar / document) has focus. */
export async function isFilenameFieldReady(): Promise<boolean> {
  const el = await getFocusedA11yElement();
  if (!el) return false;
  if (matchesMainDocumentA11y(el) || matchesSaveLocationA11y(el)) {
    return false;
  }
  return matchesSaveFilenameA11y(el);
}

export async function isSaveDialogReady(): Promise<boolean> {
  const ui = await detectSaveUi();
  return ui.kind !== "none";
}

export async function waitForSaveUi(timeoutMs = 7_000): Promise<SaveUiState> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ui = await detectSaveUi();
    if (ui.kind !== "none") return ui;
    await delay(120);
  }
  const fg = await getForegroundWindow();
  throw new Error(
    `Save UI did not appear — foreground is "${fg?.windowTitle?.slice(0, 40) ?? "?"}"`,
  );
}

export async function focusSaveDialogHwnd(
  dialog: ForegroundWindow,
): Promise<void> {
  if (dialog.hwnd) {
    await focusWindowByHwnd(
      Number(dialog.hwnd),
      dialog.windowTitle ?? "Save As",
    );
    await delay(200);
  }
}

export async function waitForSaveDialogClose(timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await isSaveDialogReady())) return;
    await delay(120);
  }
}

export async function dismissSaveUiIfOpen(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (!(await isSaveDialogReady())) {
      saveChordSentThisFlow = false;
      return;
    }
    console.info("[ripple-desktop] save UI dismiss (Esc)");
    await sendKeysToForeground("{ESC}");
    await delay(350);
  }
  saveChordSentThisFlow = false;
}

/** Paste into the currently focused filename field — caller must focus it first (Alt+N / click). */
async function clearAndPasteIntoFocusedField(text: string): Promise<void> {
  const { clipboard } = await import("electron");
  clipboard.writeText(text);
  await delay(100);

  await sendKeysToForeground("^a");
  await delay(80);
  await sendKeysToForeground("{DELETE}");
  await delay(80);

  if (await sendKeysToForeground("^v")) {
    await delay(150);
    return;
  }
  if (await pasteTextToForeground(text)) {
    await delay(150);
    return;
  }
  const typed = await sendKeysNative({ text, delayMs: 25 });
  if (typed?.ok) {
    await delay(150);
    return;
  }
  throw new Error("Could not paste into save dialog field");
}

/** @deprecated use clearAndPasteIntoFocusedField */
async function pasteIntoFocusedField(text: string): Promise<void> {
  await clearAndPasteIntoFocusedField(text);
}

/** Classic / Win11 Save As: Alt+D → folder path → Enter. */
async function setSaveDialogFolder(dir: string): Promise<void> {
  const { clipboard } = await import("electron");
  clipboard.writeText(dir);
  await sendKeysToForeground("%d");
  await delay(250);
  await sendKeysToForeground("^a");
  await delay(80);
  if (!(await sendKeysToForeground("^v"))) {
    throw new Error(`Could not set save folder: ${dir}`);
  }
  await delay(120);
  await sendKeysToForeground("{ENTER}");
  await delay(800);
  console.info(`[ripple-desktop] save folder set → ${dir}`);
}

/** Classic / Win11 Save As: Alt+N → filename only. */
async function setSaveDialogFilename(filename: string): Promise<void> {
  await sendKeysToForeground("%n");
  await delay(250);
  await pasteIntoFocusedField(filename);
  console.info(`[ripple-desktop] save filename set → ${filename}`);
}

async function refocusInlineSaveUi(ui: SaveUiState): Promise<void> {
  let target = ui.target;
  if (ui.kind === "classic_dialog") {
    const fresh = await findSaveDialogWindow();
    if (fresh?.hwnd) target = fresh;
  }
  const fg = await getForegroundWindow();
  const hwnd = resolveSaveTargetHwnd(ui, fg) ?? target?.hwnd;
  if (hwnd) {
    await focusWindowByHwnd(
      hwnd,
      fg?.windowTitle ?? target?.windowTitle ?? "Save as",
    );
    await delay(350);
  }
}

/** UIA click Save on classic #32770 / mspaint Save As (Alt+S is unreliable). */
async function clickClassicSaveButton(ui: SaveUiState): Promise<boolean> {
  const dialog =
    (await findSaveDialogWindow()) ??
    (ui.target?.hwnd ? ui.target : null);
  if (!dialog?.hwnd) return false;

  const result = await clickUiaInWindowNative({
    hwnd: dialog.hwnd,
    names: ["Save", "Save &s", "&Save"],
  });
  if (result?.ok) {
    console.info(
      `[ripple-desktop] save UIA click → "${result.name ?? "Save"}" at (${result.x},${result.y})`,
    );
    return true;
  }
  return false;
}

/** Throws if Notepad Save As is not foreground — never send Alt+D speculatively. */
async function requireNotepadInlineSaveForeground(ui: SaveUiState): Promise<void> {
  await refocusInlineSaveUi(ui);
  const fg = await getForegroundWindow();
  const proc = (fg?.processName ?? "").toLowerCase();
  if (proc !== "notepad") {
    throw new Error(
      `Save folder navigation refused — foreground is not Notepad Save As ` +
        `(got "${fg?.processName ?? "?"}" | "${(fg?.windowTitle ?? "?").slice(0, 40)}")`,
    );
  }
  if (isSaveDialogModalLocked() || isSaveDialogModeActive()) {
    return;
  }
  const open = await detectSaveUi();
  if (open.kind !== "none") return;
  if (fg && isWin11NotepadEmbeddedSave(fg)) return;
  throw new Error(
    `Save folder navigation refused — Save As UI not ready ` +
      `(got "${(fg?.windowTitle ?? "?").slice(0, 40)}")`,
  );
}

async function waitForInlineSaveReady(
  ui: SaveUiState,
  timeoutMs = 6_000,
): Promise<SaveUiState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await refocusInlineSaveUi(ui);
    const open = await detectSaveUi();
    if (open.kind !== "none") {
      return { kind: open.kind, target: open.target ?? ui.target };
    }
    const fg = await getForegroundWindow();
    if (fg && isWin11NotepadEmbeddedSave(fg)) {
      return ui;
    }
    await delay(150);
  }
  throw new Error("Save As UI not ready for folder/filename fill");
}

function isInlineSaveFolderErrorForeground(fg: ForegroundWindow | null): boolean {
  const title = (fg?.windowTitle ?? "").toLowerCase();
  return title.includes("file explorer");
}

async function isInlineSaveFolderErrorModal(): Promise<boolean> {
  const fg = await getForegroundWindow();
  if (isInlineSaveFolderErrorForeground(fg)) {
    return true;
  }
  const el = await getFocusedA11yElement();
  if (!el) return false;
  const name = (el.name ?? "").trim().toLowerCase();
  const type = (el.controlType ?? "").toLowerCase();
  return name === "ok" && type.includes("button");
}

async function dismissInlineSaveFolderErrorModal(ui: SaveUiState): Promise<void> {
  const el = await getFocusedA11yElement();
  if (el && (el.name ?? "").trim().toLowerCase() === "ok") {
    await sendKeysToForeground("{ENTER}");
  } else {
    await sendKeysToForeground("{ESC}");
  }
  await delay(500);
  if (await isInlineSaveFolderErrorModal()) {
    await sendKeysToForeground("{ESC}");
    await delay(400);
  }
  try {
    await requireNotepadInlineSaveForeground(ui);
  } catch {
    await sendKeysToForeground("{ESC}");
    await delay(300);
  }
}

async function readInlineAddressFieldValue(): Promise<string> {
  const el = await getFocusedA11yElement();
  if (!el) return "";
  const value = (el.value ?? "").trim();
  if (value) return value;
  const name = (el.name ?? "").trim();
  if (/^address:/i.test(name)) {
    return name.replace(/^address:\s*/i, "").trim();
  }
  return "";
}

async function verifyInlineAddressFolder(dir: string): Promise<boolean> {
  await sendKeysToForeground("%d");
  await delay(350);
  const raw = await readInlineAddressFieldValue();
  return Boolean(raw && folderPathsMatch(raw, dir));
}

/**
 * Move keyboard focus to filename field. If folder/address bar is active, Shift+Tab back first.
 */
export async function ensureSaveFieldFocused(ui: SaveUiState): Promise<void> {
  const navKeys =
    ui.kind === "classic_dialog"
      ? ["%n", "{TAB}", "+{TAB}", "%n"]
      : ["%n", "+{TAB}", "{TAB}", "{F6}", "%n", "{TAB}", "%n"];

  if (ui.kind === "inline_bar") {
    await refocusInlineSaveUi(ui);
    await sendKeysToForeground("%n");
    await delay(300);
  }

  for (let round = 0; round < 20; round++) {
    if (ui.kind === "inline_bar" && round > 0 && round % 6 === 0) {
      await refocusInlineSaveUi(ui);
      await sendKeysToForeground("%n");
      await delay(250);
    }

    const el = await getFocusedA11yElement();

    if (el && matchesSaveLocationA11y(el)) {
      console.info(
        `[ripple-desktop] save focus on folder bar — Shift+Tab to filename`,
      );
      await sendKeysToForeground("+{TAB}");
      await delay(160);
      continue;
    }

    if (el && matchesMainDocumentA11y(el)) {
      if (round < navKeys.length) {
        await sendKeysToForeground(navKeys[round]!);
        await delay(160);
      }
      continue;
    }

    if (el && matchesSaveFilenameA11y(el)) {
      console.info(
        `[ripple-desktop] save filename field focused → ${el.controlType} "${(el.name ?? "").slice(0, 40)}"`,
      );
      return;
    }

    if (round < navKeys.length) {
      await sendKeysToForeground(navKeys[round]!);
      await delay(160);
    } else {
      await delay(100);
    }
  }

  if (await isFilenameFieldReady()) return;

  if (ui.kind === "inline_bar") {
    if (isSaveDialogModalLocked() || isSaveDialogModeActive()) {
      await sendKeysToForeground("%n");
      await delay(300);
      return;
    }
    const clicked = await clickInlineSaveFilenameField(ui);
    if (clicked && (await isFilenameFieldReady())) return;
    await sendKeysToForeground("%n");
    await delay(300);
    if (await isFilenameFieldReady()) return;
    if (clicked) {
      console.info(
        "[ripple-desktop] save filename focus via click (UIA unconfirmed)",
      );
      return;
    }
  }

  throw new Error(
    "Save filename field not focused — refusing to paste (folder bar or document may still be active)",
  );
}

/** Click the Win11 inline Save As filename combobox (UIA focus is unreliable). */
async function clickInlineSaveFilenameField(ui: SaveUiState): Promise<boolean> {
  const fg = await getForegroundWindow();
  let hwnd =
    fg?.hwnd && (fg.processName ?? "").toLowerCase() === "notepad"
      ? fg.hwnd
      : ui.target?.hwnd;
  if (!hwnd) {
    const windows = await listVisibleWindowsNative();
    hwnd =
      windows.find((w) => (w.processName ?? "").toLowerCase() === "notepad")
        ?.hwnd ?? undefined;
  }
  if (!hwnd) return false;

  let center = await getWindowRectCenter(hwnd);
  if (!center) {
    const primary = await getPrimaryScreenCenter();
    if (primary) {
      center = { x: primary.x, y: Math.round(primary.y * 1.35) };
    }
  }
  if (!center) return false;

  const x = center.x;
  const y = center.y + (center.y > 400 ? 120 : 210);
  const clicked = await mouseClickNative({ x, y, button: "left" });
  if (clicked?.ok) {
    console.info(`[ripple-desktop] save filename click → (${x},${y})`);
    await delay(300);
    return true;
  }
  return false;
}

function normalizeFolderPath(path: string): string {
  return path
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function folderPathsMatch(observed: string, targetDir: string): boolean {
  const obs = normalizeFolderPath(observed);
  const target = normalizeFolderPath(targetDir);
  if (!obs || !target) return false;
  if (obs === target) return true;
  if (obs.includes(target) || target.includes(obs)) return true;
  const targetLeaf = basename(targetDir).toLowerCase();
  const obsLeaf = obs.split("/").pop() ?? "";
  return obsLeaf === targetLeaf;
}

function inlineFilenameMatchesTarget(parts: SavePathParts, raw: string): boolean {
  const text = raw.trim().replace(/^["']|["']$/g, "");
  if (!text) return false;
  if (text.toLowerCase() === parts.filename.toLowerCase()) return true;
  if (text.toLowerCase() === parts.fullPath.toLowerCase()) return true;
  if (normalizeFolderPath(text) === normalizeFolderPath(parts.fullPath)) {
    return true;
  }
  if (
    text.includes("\\") &&
    text.toLowerCase().endsWith(parts.filename.toLowerCase())
  ) {
    return (
      folderPathsMatch(text, parts.dir) ||
      text.toLowerCase().includes(normalizeFolderPath(parts.dir))
    );
  }
  return false;
}

function isCorruptSaveFilename(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/♦/.test(t)) return true;
  if (t.length === 1 && !/[a-z0-9]/i.test(t)) return true;
  return false;
}

/** Set filename in Win11 inline save and verify read-back (folder must be set first). */
async function setVerifiedInlineSaveFilename(
  parts: SavePathParts,
  ui: SaveUiState,
): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await refocusInlineSaveUi(ui);
    if (!(await isSaveDialogReady()) && !isSaveDialogModalLocked()) {
      throw new Error("Save dialog closed during filename fill");
    }
    await sendKeysToForeground("%n");
    await delay(350);
    await clearAndPasteIntoFocusedField(parts.filename);

    await delay(300);
    const value = await readInlineFilenameValue(ui);
    if (
      inlineFilenameMatchesTarget(parts, value) &&
      !isCorruptSaveFilename(value)
    ) {
      console.info(
        `[ripple-desktop] save filename verified → ${value || parts.filename}`,
      );
      return;
    }

    if (isCorruptSaveFilename(value)) {
      console.warn(
        `[ripple-desktop] save filename corrupt (${JSON.stringify(value)}) — retry ${attempt + 1}/${maxAttempts}`,
      );
      continue;
    }

    console.warn(
      `[ripple-desktop] save filename mismatch (${value.slice(0, 40) || "(empty)"}) — retry ${attempt + 1}/${maxAttempts}`,
    );

    if (!value && attempt >= maxAttempts - 2) {
      console.warn(
        `[ripple-desktop] save filename set via click+paste (UIA unreadable) → ${parts.filename}`,
      );
      return;
    }
  }

  const final = await readInlineFilenameValue(ui);
  if (
    inlineFilenameMatchesTarget(parts, final) &&
    !isCorruptSaveFilename(final)
  ) {
    return;
  }
  throw new Error(
    `Could not set save filename to ${parts.filename}` +
      (final ? ` (field shows "${final.slice(0, 40)}")` : " (field unreadable)"),
  );
}

async function readInlineFilenameValue(ui: SaveUiState): Promise<string> {
  await refocusInlineSaveUi(ui);
  await sendKeysToForeground("%n");
  await delay(120);
  const el = await getFocusedA11yElement();
  if (!el || !matchesSaveFilenameA11y(el)) return "";
  const value = (el.value ?? "").trim();
  if (value) return value;
  const name = (el.name ?? "").trim();
  if (name && !/^file\s*name/i.test(name)) return name;
  return "";
}

/** Poll filename field UIA value — never Tab away (that wipes full-path paste). */
async function pollInlineSavePathReady(
  parts: SavePathParts,
  ui: SaveUiState,
): Promise<boolean> {
  const deadline = Date.now() + INLINE_FOLDER_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await refocusInlineSaveUi(ui);
    await sendKeysToForeground("%n");
    await delay(120);
    const el = await getFocusedA11yElement();
    if (el && matchesSaveFilenameA11y(el)) {
      const raw = (el.value ?? "").trim();
      if (raw && inlineFilenameMatchesTarget(parts, raw)) {
        console.info(`[ripple-desktop] save path verified → ${parts.fullPath}`);
        return true;
      }
    }
    await delay(INLINE_FOLDER_POLL_MS);
  }
  return false;
}

/** Win11 inline save: Alt+D address edit (requires Notepad Save As foreground). */
async function trySetInlineSaveFolder(
  dir: string,
  ui: SaveUiState,
): Promise<boolean> {
  await requireNotepadInlineSaveForeground(ui);
  await sendKeysToForeground("%n");
  await delay(200);
  await requireNotepadInlineSaveForeground(ui);

  const { clipboard } = await import("electron");
  clipboard.writeText(dir);

  if (!(await sendKeysToForeground("%d"))) {
    return false;
  }
  await delay(350);

  await sendKeysToForeground("^a");
  await delay(80);
  if (!(await sendKeysToForeground("^v"))) {
    return false;
  }
  await delay(150);
  if (!(await sendKeysToForeground("{ENTER}"))) {
    return false;
  }
  await delay(1000);

  if (await isInlineSaveFolderErrorModal()) {
    await dismissInlineSaveFolderErrorModal(ui);
    if (existsSync(dir)) {
      console.warn(
        `[ripple-desktop] save folder error modal dismissed — proceeding (exists): ${dir}`,
      );
      await sendKeysToForeground("%n");
      await delay(150);
      return true;
    }
    throw new Error(`Folder does not exist: ${dir}`);
  }

  await requireNotepadInlineSaveForeground(ui);

  if (!(await verifyInlineAddressFolder(dir))) {
    await delay(400);
    if (!(await verifyInlineAddressFolder(dir))) {
      if (await isInlineSaveFolderErrorModal()) {
        await dismissInlineSaveFolderErrorModal(ui);
        if (existsSync(dir)) {
          console.warn(
            `[ripple-desktop] save folder error modal dismissed — proceeding (exists): ${dir}`,
          );
          await sendKeysToForeground("%n");
          await delay(150);
          return true;
        }
        throw new Error(`Folder does not exist: ${dir}`);
      }
      if (existsSync(dir)) {
        console.warn(
          `[ripple-desktop] save folder verify uncertain — proceeding (exists): ${dir}`,
        );
        await sendKeysToForeground("%n");
        await delay(150);
        console.info(`[ripple-desktop] save folder set → ${dir}`);
        return true;
      }
      return false;
    }
  }

  await sendKeysToForeground("%n");
  await delay(150);
  console.info(`[ripple-desktop] save folder set → ${dir}`);
  return true;
}

async function trySetClassicSaveFolder(dir: string): Promise<boolean> {
  const { clipboard } = await import("electron");
  clipboard.writeText(dir);

  await sendKeysToForeground("%d");
  await delay(280);
  const afterAltD = await getFocusedA11yElement();
  if (
    afterAltD &&
    !matchesMainDocumentA11y(afterAltD) &&
    !matchesSaveFilenameA11y(afterAltD)
  ) {
    await sendKeysToForeground("^a");
    await delay(60);
    if (await sendKeysToForeground("^v")) {
      await delay(120);
      await sendKeysToForeground("{ENTER}");
      await delay(800);
      console.info(`[ripple-desktop] save folder set → ${dir}`);
      return true;
    }
  }

  for (let i = 0; i < 5; i++) {
    await sendKeysToForeground("{TAB}");
    await delay(120);
    const el = await getFocusedA11yElement();
    if (el && matchesSaveLocationA11y(el)) {
      await sendKeysToForeground("^a");
      await delay(60);
      await sendKeysToForeground("^v");
      await delay(120);
      await sendKeysToForeground("{ENTER}");
      await delay(800);
      console.info(`[ripple-desktop] save folder set → ${dir}`);
      return true;
    }
  }
  return false;
}

async function navigateClassicSaveFolder(dir: string): Promise<void> {
  if (await trySetClassicSaveFolder(dir)) return;

  const { clipboard } = await import("electron");
  clipboard.writeText(dir);
  await sendKeysToForeground("^l");
  await delay(280);
  await sendKeysToForeground("^a");
  await delay(80);
  if (await sendKeysToForeground("^v")) {
    await delay(120);
    await sendKeysToForeground("{ENTER}");
    await delay(800);
    console.info(`[ripple-desktop] save folder set → ${dir}`);
    return;
  }

  throw new Error(`Could not set save folder to ${dir}`);
}

async function fillClassicDialogPath(parts: SavePathParts, ui: SaveUiState): Promise<void> {
  const dialog = (await findSaveDialogWindow()) ?? ui.target;
  if (dialog?.hwnd) {
    ui = { kind: "classic_dialog", target: dialog };
    await focusSaveDialogHwnd(dialog);
    await delay(200);
  }

  await ensureSaveFieldFocused(ui);

  // Notepad parity: type full path into filename (works for Paint/mspaint classic Save As).
  await sendKeysToSaveTarget(ui, { keys: "%n", delayMs: 250 });
  await delay(200);
  await sendKeysToSaveTarget(ui, { keys: "^a", delayMs: 80 });
  await sendKeysToSaveTarget(ui, { keys: "{DELETE}", delayMs: 80 });
  const typed = await sendKeysToSaveTarget(ui, {
    text: parts.fullPath,
    delayMs: 35,
  });
  if (typed) {
    await delay(300);
    console.info(`[ripple-desktop] save path typed (classic) → ${parts.fullPath}`);
    return;
  }

  // Fallback: Alt+D folder + Alt+N filename
  await setSaveDialogFolder(parts.dir);
  await ensureSaveFieldFocused(ui);
  await setSaveDialogFilename(parts.filename);
}

async function fillInlineBarPath(parts: SavePathParts, ui: SaveUiState): Promise<void> {
  await refocusInlineSaveUi(ui);
  await delay(400);
  const readyUi = await waitForInlineSaveReady(ui);
  ui = readyUi;

  // Win11 Notepad: type full path into filename (target HWND — not foreground).
  await refocusInlineSaveUi(ui);
  await sendKeysToSaveTarget(ui, { keys: "%n", delayMs: 250 });
  await delay(350);
  await sendKeysToSaveTarget(ui, { keys: "^a", delayMs: 80 });
  await sendKeysToSaveTarget(ui, { keys: "{DELETE}", delayMs: 80 });
  const typed = await sendKeysToSaveTarget(ui, {
    text: parts.fullPath,
    delayMs: 35,
  });
  if (!typed) {
    throw new Error(`Could not type save path into filename field`);
  }
  await delay(400);
  console.info(`[ripple-desktop] save path typed → ${parts.fullPath}`);

  const value = await readInlineFilenameValue(ui);
  if (isCorruptSaveFilename(value)) {
    await setVerifiedInlineSaveFilename(parts, ui);
  }
}

async function isSaveStillOpen(): Promise<boolean> {
  const fg = await getForegroundWindow();
  if (fg && isConfirmSaveAsTitle(fg.windowTitle)) return true;
  return isSaveDialogReady();
}

async function confirmSaveDialog(
  ui: SaveUiState,
  fullPath?: string,
): Promise<void> {
  const deadline = Date.now() + 22_000;
  const parts = fullPath ? splitSavePath(fullPath) : null;
  if (ui.kind === "inline_bar" || ui.kind === "classic_dialog") {
    await refocusInlineSaveUi(ui);
  }
  try {
    await ensureSaveFieldFocused(ui);
  } catch {
    /* Alt+S / Enter may still work */
  }
  await delay(200);

  const savedOnDisk = (): boolean => {
    if (!fullPath || !existsSync(fullPath)) return false;
    try {
      verifySaveWritten(fullPath);
      return true;
    } catch {
      return false;
    }
  };

  for (let attempt = 0; attempt < 5 && Date.now() < deadline; attempt++) {
    if (savedOnDisk()) {
      console.info("[ripple-desktop] save confirmed (file on disk)");
      return;
    }

    if (ui.kind === "inline_bar" && parts) {
      await refocusInlineSaveUi(ui);
      const current = await readInlineFilenameValue(ui);
      if (isCorruptSaveFilename(current)) {
        try {
          await setVerifiedInlineSaveFilename(parts, ui);
        } catch (e: unknown) {
          console.warn(
            "[ripple-desktop] save filename re-verify before confirm:",
            e instanceof Error ? e.message : e,
          );
        }
      }
      for (const keys of ["{ENTER}", "%s"]) {
        await sendKeysToSaveTarget(ui, { keys, delayMs: 120 });
        await delay(900);
        if (savedOnDisk()) {
          console.info(`[ripple-desktop] save confirmed via ${keys}`);
          return;
        }
      }
    }

    if (ui.kind === "classic_dialog" && parts) {
      await refocusInlineSaveUi(ui);
      if (await clickClassicSaveButton(ui)) {
        await delay(900);
        if (savedOnDisk()) {
          console.info("[ripple-desktop] save confirmed via UIA Save");
          return;
        }
        if (await dismissConfirmSaveAsOverwriteIfOpen()) {
          await delay(800);
          if (savedOnDisk()) {
            console.info("[ripple-desktop] save confirmed via UIA Save (overwrite)");
            return;
          }
        }
      }
      for (const keys of ["%s", "{ENTER}"]) {
        await sendKeysToSaveTarget(ui, { keys, delayMs: 120 });
        await delay(900);
        if (await dismissConfirmSaveAsOverwriteIfOpen()) {
          await delay(800);
          if (savedOnDisk()) {
            console.info(`[ripple-desktop] save confirmed via ${keys} (overwrite)`);
            return;
          }
          continue;
        }
        if (!(await isSaveStillOpen())) {
          await delay(600);
          if (savedOnDisk()) {
            console.info(`[ripple-desktop] save confirmed via ${keys}`);
            return;
          }
        }
      }
    }

    if (await dismissConfirmSaveAsOverwriteIfOpen()) {
      await delay(800);
      if (savedOnDisk()) {
        console.info("[ripple-desktop] save confirmed via overwrite Yes");
        return;
      }
      if (ui.kind === "inline_bar" || ui.kind === "classic_dialog") {
        await refocusInlineSaveUi(ui);
      }
      for (const keys of ["{ENTER}", "%s"]) {
        const sent =
          ui.kind === "inline_bar" || ui.kind === "classic_dialog"
            ? await sendKeysToSaveTarget(ui, { keys, delayMs: 120 })
            : await sendKeysToForeground(keys);
        if (!sent) continue;
        await delay(700);
        if (savedOnDisk()) {
          console.info(`[ripple-desktop] save confirmed after overwrite + ${keys}`);
          return;
        }
      }
      continue;
    }

    if (ui.kind === "classic_dialog") {
      continue;
    }

    for (const keys of ["%s", "{ENTER}"]) {
      if (!(await sendKeysToForeground(keys))) continue;
      await delay(700);
      if (await dismissConfirmSaveAsOverwriteIfOpen()) {
        await delay(800);
        if (savedOnDisk()) {
          console.info(`[ripple-desktop] save confirmed via ${keys} (overwrite)`);
          return;
        }
        continue;
      }
      if (!(await isSaveStillOpen())) {
        await delay(600);
        if (savedOnDisk()) {
          console.info(`[ripple-desktop] save confirmed via ${keys}`);
          return;
        }
      }
    }
  }
  if (savedOnDisk()) return;
  throw new Error("Could not confirm Save");
}

async function fillSaveTarget(parts: SavePathParts, ui: SaveUiState): Promise<void> {
  if (ui.kind === "classic_dialog") {
    await fillClassicDialogPath(parts, ui);
  } else {
    await fillInlineBarPath(parts, ui);
  }

  await confirmSaveDialog(ui, parts.fullPath);
}

function verifySaveWritten(fullPath: string): void {
  if (!existsSync(fullPath)) {
    throw new Error(`Save verification failed — file not found: ${fullPath}`);
  }
  const st = statSync(fullPath);
  const age = Date.now() - st.mtimeMs;
  if (age > SAVE_VERIFY_MAX_AGE_MS) {
    throw new Error(
      `Save verification failed — ${fullPath} was not modified recently (${Math.round(age / 1000)}s old)`,
    );
  }
  if (st.size <= 0) {
    throw new Error(`Save verification failed — ${fullPath} is empty`);
  }
  try {
    const sample = readFileSync(fullPath, "utf8").trim();
    if (!sample.length) {
      throw new Error(`Save verification failed — ${fullPath} has no content`);
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("verification failed")) {
      throw e;
    }
    /* binary file — size check above is enough */
  }
}

async function waitForSaveVerified(
  fullPath: string,
  timeoutMs = 6_000,
): Promise<void> {
  const started = Date.now();
  let lastErr: Error | null = null;
  while (Date.now() - started < timeoutMs) {
    try {
      verifySaveWritten(fullPath);
      return;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await delay(300);
    }
  }
  throw lastErr ?? new Error(`Save verification timeout: ${fullPath}`);
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
  await delay(400);

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
      await delay(250);
    }
  }
}

export async function pinEditorForSaveRetry(): Promise<void> {
  extendCommandFocusGrace(15_000);
  const open = await detectSaveUi();
  if (open.kind !== "none") {
    const dialog =
      open.kind === "classic_dialog"
        ? ((await findSaveDialogWindow()) ?? open.target)
        : open.target;
    if (dialog?.hwnd) {
      await focusSaveDialogHwnd(dialog);
      await delay(300);
      try {
        await ensureSaveFieldFocused(open);
      } catch {
        /* fill step will retry focus */
      }
      console.info(
        `[ripple-desktop] save retry pinned → ${dialog.processName ?? "dialog"} | "${dialog.windowTitle?.slice(0, 40) ?? "Save As"}"`,
      );
      return;
    }
  }
  await restoreFocusContext();
  const editor = resolveTypingFocusTarget();
  if (!editor?.hwnd) return;
  await focusWindowByHwnd(editor.hwnd, editor.windowTitle);
  await delay(400);
  console.info(
    `[ripple-desktop] save retry focus pinned → ${editor.processName} | "${editor.windowTitle.slice(0, 40)}"`,
  );
}

async function trySingleSaveChord(keys: string): Promise<SaveUiState | null> {
  const ok = await sendKeysToEditor(keys);
  if (!ok) return null;
  saveChordSentThisFlow = true;
  console.info(`[ripple-desktop] save trigger sent: ${keys}`);

  const started = Date.now();
  while (Date.now() - started < SAVE_CHORD_WAIT_MS) {
    const ui = await detectSaveUi();
    if (ui.kind !== "none") {
      console.info(`[ripple-desktop] save UI detected: ${ui.kind}`);
      return ui;
    }
    await delay(150);
  }
  return null;
}

/**
 * Open save UI once. Save-As always uses Ctrl+Shift+S (full picker). No chord chain.
 */
export async function triggerSaveAsDialog(
  opts?: { skipIfOpen?: boolean },
): Promise<SaveUiState> {
  if (opts?.skipIfOpen) {
    const open = await detectSaveUi();
    if (open.kind !== "none") {
      console.info(`[ripple-desktop] save UI already open: ${open.kind}`);
      return open;
    }
  }

  if (saveChordSentThisFlow) {
    throw new Error("Save chord already sent this flow — refusing duplicate Ctrl+S");
  }

  await focusEditorForSaveChord();

  const chord = await trySingleSaveChord("^+s");
  if (chord) return chord;

  throw new Error("Save UI did not appear after Ctrl+Shift+S");
}

/** Ctrl+S only when open document basename matches target — verify mtime bump. */
async function trySilentOverwrite(parts: SavePathParts): Promise<boolean> {
  const editor = resolveTypingFocusTarget();
  const fg = await getForegroundWindow();
  const title = editor?.windowTitle ?? fg?.windowTitle ?? "";

  if (!shouldUseSilentSave(title, parts.fullPath)) {
    return false;
  }

  const mtimeBefore = existsSync(parts.fullPath)
    ? statSync(parts.fullPath).mtimeMs
    : 0;

  await focusEditorForSaveChord();
  const ok = await sendKeysToEditor("^s");
  if (!ok) return false;
  console.info("[ripple-desktop] save trigger sent: ^s (silent same-file)");
  await delay(600);

  if (!existsSync(parts.fullPath)) return false;
  const mtimeAfter = statSync(parts.fullPath).mtimeMs;
  return mtimeAfter > mtimeBefore;
}

/**
 * Win11-aware save: single Ctrl+Shift+S → focus filename → set name + folder → verify.
 */
export async function runSaveFileDialogFlow(
  fullPath: string,
  opts?: SaveFlowOptions,
): Promise<void> {
  const parts = splitSavePath(fullPath);
  saveChordSentThisFlow = false;

  if (existsSync(parts.fullPath)) {
    try {
      unlinkSync(parts.fullPath);
      console.info(
        `[ripple-desktop] removed existing target before save → ${parts.fullPath}`,
      );
    } catch {
      /* continue — overwrite flow may handle it */
    }
  }

  const corruptDiamond = join(parts.dir, "♦.txt");
  if (existsSync(corruptDiamond)) {
    try {
      unlinkSync(corruptDiamond);
      console.info("[ripple-desktop] removed corrupt ♦.txt before save");
    } catch {
      /* continue */
    }
  }

  try {
    if (!opts?.recoveryAttempt) {
      await dismissExtraNotepadInstances();
    }

    if (!opts?.recoveryAttempt && (await trySilentOverwrite(parts))) {
      await waitForSaveVerified(parts.fullPath);
      console.info(`[ripple-desktop] save verified (silent) → ${parts.fullPath}`);
      return;
    }

    if (opts?.recoveryAttempt) {
      await dismissConfirmSaveAsOverwriteIfOpen();
      await delay(400);
      let open = await detectSaveUi();
      if (open.kind !== "none") {
        console.info("[ripple-desktop] save recovery: reusing open dialog");
        saveChordSentThisFlow = true;
        enterSaveDialogMode();
        lockSaveDialogModal();
        if (open.target?.hwnd) {
          const dialog =
            open.kind === "classic_dialog"
              ? ((await findSaveDialogWindow()) ?? open.target)
              : open.target;
          if (dialog?.hwnd) {
            await focusWindowByHwnd(
              dialog.hwnd,
              dialog.windowTitle ?? "Save as",
            );
            adoptSaveDialogTarget(dialog);
          }
        }
        await delay(300);
        if (isConfirmSaveAsTitle((await getForegroundWindow())?.windowTitle)) {
          await dismissConfirmSaveAsOverwriteIfOpen();
          await delay(400);
        }
        await fillSaveTarget(parts, open);
        await waitForSaveDialogClose(8_000);
        await delay(400);
        await waitForSaveVerified(parts.fullPath);
        console.info(`[ripple-desktop] save verified (recovery) → ${parts.fullPath}`);
        return;
      }
      const extra = await dismissExtraNotepadInstances();
      if (extra > 0) {
        open = await detectSaveUi();
        if (open.kind !== "none") {
          console.info("[ripple-desktop] save recovery: reusing open dialog (after cleanup)");
          saveChordSentThisFlow = true;
          enterSaveDialogMode();
          lockSaveDialogModal();
          if (open.target?.hwnd) {
            adoptSaveDialogTarget(open.target);
          }
          await delay(300);
          await fillSaveTarget(parts, open);
          await waitForSaveDialogClose(8_000);
          await delay(400);
          await waitForSaveVerified(parts.fullPath);
          console.info(`[ripple-desktop] save verified (recovery) → ${parts.fullPath}`);
          return;
        }
      }
      await pinEditorForSaveRetry();
      saveChordSentThisFlow = false;
    }

    const ui = await triggerSaveAsDialog({
      skipIfOpen: Boolean(opts?.recoveryAttempt),
    });

    enterSaveDialogMode();
    lockSaveDialogModal();

    if (ui.target) {
      adoptSaveDialogTarget(ui.target);
    }
    await delay(400);

    await fillSaveTarget(parts, ui);

    await waitForSaveDialogClose(8_000);
    await delay(400);
    await waitForSaveVerified(parts.fullPath);
    console.info(`[ripple-desktop] save verified → ${parts.fullPath}`);
  } finally {
    unlockSaveDialogModal();
    exitSaveDialogMode();
    saveChordSentThisFlow = false;
  }
}

/** @deprecated use waitForSaveUi */
export async function waitForSaveDialogWindow(
  timeoutMs = 7_000,
): Promise<ForegroundWindow> {
  const ui = await waitForSaveUi(timeoutMs);
  return ui.target ?? (await getForegroundWindow())!;
}
