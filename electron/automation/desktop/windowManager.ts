import { hideOverlay } from "../../windows/overlay.js";
import type { NativeAppEntry } from "./nativeAppRegistry.js";
import { listVisibleWindows, type VisibleWindow } from "./windowEnum.js";
import {
  closeWindowByHwnd,
  focusWindowByHwnd,
  minimizeAllWindowsNative,
} from "../../native/win32Bridge.js";
import { delay } from "../delay.js";

/** UWP host — many unrelated apps share this process; require title keyword match. */
const AMBIGUOUS_PROCESS_NAMES = new Set(["applicationframehost"]);

/** Desktop shell — not a File Explorer window. */
const DESKTOP_SHELL_TITLES = new Set(["program manager"]);

function scoreWindow(win: VisibleWindow, app: NativeAppEntry): number {
  const proc = win.processName.toLowerCase();
  const title = win.windowTitle.toLowerCase();
  const className = (win.className ?? "").toLowerCase();

  if (app.id === "file-explorer") {
    if (DESKTOP_SHELL_TITLES.has(title.trim())) return 0;
    if (className === "cabinetwclass") return 90;
    if (title.includes("file explorer")) return 70;
    if (proc === "explorer" && title.includes("\\")) return 55;
  }

  if (AMBIGUOUS_PROCESS_NAMES.has(proc) && (app.titleKeywords?.length ?? 0) > 0) {
    const hasKeyword = app.titleKeywords!.some((kw) =>
      title.includes(kw.toLowerCase()),
    );
    if (!hasKeyword) return 0;
  }

  let score = 0;
  for (const p of app.processNames) {
    if (proc === p.toLowerCase()) score += 50;
    else if (proc.includes(p.toLowerCase())) score += 30;
  }

  for (const kw of app.titleKeywords ?? []) {
    if (title.includes(kw.toLowerCase())) score += 40;
  }

  for (const alias of app.aliases) {
    if (title.includes(alias.toLowerCase())) score += 25;
  }

  return score;
}

async function findBestWindowAsync(
  app: NativeAppEntry,
): Promise<VisibleWindow | null> {
  const rows = await listVisibleWindows();
  let best: VisibleWindow | null = null;
  let bestScore = 0;

  for (const win of rows) {
    const score = scoreWindow(win, app);
    if (score > bestScore) {
      bestScore = score;
      best = win;
    }
  }

  return bestScore >= 25 ? best : null;
}

export async function isAppRunning(app: NativeAppEntry): Promise<boolean> {
  const win = await findBestWindowAsync(app);
  return win !== null;
}

export async function focusAppWindow(app: NativeAppEntry): Promise<string> {
  hideOverlay();

  if (process.platform !== "win32") {
    throw new Error("Window focus is only supported on Windows");
  }

  const win = await findBestWindowAsync(app);
  if (!win) {
    throw new Error(
      `No window found for ${app.aliases[0] ?? app.id}. Try "Open ${app.aliases[0]}" first.`,
    );
  }

  await focusWindowByHwnd(win.hwnd, win.windowTitle);

  console.info(
    `[ripple-desktop] Focused ${app.id} hwnd=${win.hwnd} title="${win.windowTitle}"`,
  );
  return `Switched to ${app.aliases[0] ?? app.id}`;
}

/**
 * Prefer an IDE window whose title includes any of the path/file hints
 * (so we focus the project under repair, not an unrelated Cursor window).
 */
export async function focusAppWindowPreferringTitle(
  app: NativeAppEntry,
  titleHints: string[],
): Promise<string> {
  hideOverlay();

  if (process.platform !== "win32") {
    throw new Error("Window focus is only supported on Windows");
  }

  const hints = titleHints
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length >= 2);

  if (hints.length === 0) {
    return focusAppWindow(app);
  }

  const rows = await listVisibleWindows();
  let best: VisibleWindow | null = null;
  let bestScore = 0;

  for (const win of rows) {
    let score = scoreWindow(win, app);
    if (score < 25) continue;
    const title = win.windowTitle.toLowerCase();
    for (const hint of hints) {
      if (title.includes(hint)) score += 80;
    }
    if (score > bestScore) {
      bestScore = score;
      best = win;
    }
  }

  if (!best) {
    return focusAppWindow(app);
  }

  await focusWindowByHwnd(best.hwnd, best.windowTitle);
  console.info(
    `[ripple-desktop] Focused ${app.id} hwnd=${best.hwnd} title="${best.windowTitle}" (hint match)`,
  );
  return `Switched to ${app.aliases[0] ?? app.id}`;
}

/** True if an app window title already mentions any hint (folder/file name). */
export async function isAppWindowShowingTitle(
  app: NativeAppEntry,
  titleHints: string[],
): Promise<boolean> {
  const hints = titleHints
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length >= 2);
  if (hints.length === 0) return false;

  const rows = await listVisibleWindows();
  for (const win of rows) {
    if (scoreWindow(win, app) < 25) continue;
    const title = win.windowTitle.toLowerCase();
    if (hints.some((h) => title.includes(h))) return true;
  }
  return false;
}

export async function closeAppWindow(app: NativeAppEntry): Promise<string> {
  hideOverlay();

  if (process.platform !== "win32") {
    throw new Error("Window close is only supported on Windows");
  }

  const win = await findBestWindowAsync(app);
  if (!win) {
    throw new Error(`No window found for ${app.aliases[0] ?? app.id}`);
  }

  await closeWindowByHwnd(win.hwnd);

  console.info(
    `[ripple-desktop] Closed ${app.id} hwnd=${win.hwnd} title="${win.windowTitle}"`,
  );
  return `Closed ${app.aliases[0] ?? app.id}`;
}

export async function minimizeAllWindows(): Promise<string> {
  hideOverlay();

  if (process.platform !== "win32") {
    throw new Error("Minimize all is only supported on Windows");
  }

  const count = await minimizeAllWindowsNative();
  console.info(`[ripple-desktop] Minimized ${count} windows`);
  return `Minimized ${count} windows`;
}
