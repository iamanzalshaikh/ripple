import { hideOverlay } from "../../windows/overlay.js";
import type { NativeAppEntry } from "./nativeAppRegistry.js";
import { listVisibleWindows, type VisibleWindow } from "./windowEnum.js";
import {
  closeWindowByHwnd,
  focusWindowByHwnd,
  minimizeAllWindowsNative,
} from "../../native/win32Bridge.js";

function scoreWindow(win: VisibleWindow, app: NativeAppEntry): number {
  const proc = win.processName.toLowerCase();
  const title = win.windowTitle.toLowerCase();

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
