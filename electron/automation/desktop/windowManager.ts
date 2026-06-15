import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hideOverlay } from "../../windows/overlay.js";
import type { NativeAppEntry } from "./nativeAppRegistry.js";
import { listVisibleWindows, type VisibleWindow } from "./windowEnum.js";

const execFileAsync = promisify(execFile);

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

const FOCUS_HWND_SCRIPT = (hwnd: number) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RippleWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
$h = [IntPtr]${hwnd}
[void][RippleWin]::ShowWindow($h, 9)
[void][RippleWin]::BringWindowToTop($h)
[void][RippleWin]::SetForegroundWindow($h)
"ok"
`.trim();

const CLOSE_HWND_SCRIPT = (hwnd: number) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RippleWin {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
[void][RippleWin]::SendMessage([IntPtr]${hwnd}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
"ok"
`.trim();

const MINIMIZE_ALL_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RippleWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$count = 0
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  if ([RippleWin]::ShowWindow($_.MainWindowHandle, 6)) { $count++ }
}
$count
`.trim();

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

  await execFileAsync(
    "powershell",
    ["-NoProfile", "-Command", FOCUS_HWND_SCRIPT(win.hwnd)],
    { windowsHide: true },
  );

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

  await execFileAsync(
    "powershell",
    ["-NoProfile", "-Command", CLOSE_HWND_SCRIPT(win.hwnd)],
    { windowsHide: true },
  );

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

  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-Command", MINIMIZE_ALL_SCRIPT],
    { windowsHide: true },
  );

  const count = parseInt(stdout.trim(), 10) || 0;
  console.info(`[ripple-desktop] Minimized ${count} windows`);
  return `Minimized ${count} windows`;
}
