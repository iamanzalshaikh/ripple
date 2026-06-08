import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FocusContext } from "./focusContext.js";

const execFileAsync = promisify(execFile);

/** Enum all visible windows — Chrome often hides "WhatsApp" in the title when another tab is active. */
const ENUM_WINDOWS_SCRIPT = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class RippleEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@
$list = New-Object System.Collections.Generic.List[object]
$cb = [RippleEnum+EnumProc]{
  param($hWnd, $lParam)
  if (-not [RippleEnum]::IsWindowVisible($hWnd)) { return $true }
  $titleSb = New-Object System.Text.StringBuilder 512
  [void][RippleEnum]::GetWindowText($hWnd, $titleSb, 512)
  $title = $titleSb.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  $classSb = New-Object System.Text.StringBuilder 256
  [void][RippleEnum]::GetClassName($hWnd, $classSb, 256)
  $class = $classSb.ToString()
  $windowPid = [uint32]0
  [void][RippleEnum]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
  $proc = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
  $pname = if ($proc) { $proc.ProcessName } else { "unknown" }
  $list.Add([pscustomobject]@{
    hwnd = [int64]$hWnd
    processName = $pname
    windowTitle = $title
    className = $class
  }) | Out-Null
  return $true
}
[void][RippleEnum]::EnumWindows($cb, [IntPtr]::Zero)
$list | ConvertTo-Json -Compress
`.trim();

interface WinRow {
  hwnd: number;
  processName: string;
  windowTitle: string;
  className: string;
}

async function listVisibleWindows(): Promise<WinRow[]> {
  if (process.platform !== "win32") return [];

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", ENUM_WINDOWS_SCRIPT],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as WinRow | WinRow[];
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] window enum failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

const BROWSER_PROCESS =
  /^(chrome|msedge|firefox|brave|opera|vivaldi|chromium)$/i;

const CHROME_CLASS = /Chrome_WidgetWin_1/i;

function toFocusContext(row: WinRow): FocusContext {
  const processName = row.processName ?? "chrome";
  const windowTitle = row.windowTitle ?? "";
  return {
    hwnd: Number(row.hwnd) || 0,
    processName,
    windowTitle,
    capturedAt: Date.now(),
    isGmail: false,
    isWhatsApp: true,
    isSlack: false,
    isNotion: false,
    isYouTube: false,
    isBrowser: BROWSER_PROCESS.test(processName),
  };
}

/** Window title already shows WhatsApp (that tab is active). */
export async function findWhatsAppBrowserWindow(): Promise<FocusContext | null> {
  const windows = await listVisibleWindows();
  const match = windows.find(
    (w) =>
      BROWSER_PROCESS.test(w.processName) &&
      /whatsapp/i.test(w.windowTitle),
  );
  if (match?.hwnd) {
    console.info(
      `[ripple-desktop] WA window (title): "${match.windowTitle.slice(0, 55)}"`,
    );
    return toFocusContext(match);
  }
  return null;
}

/** Any visible Chrome main window (WhatsApp may be open on a background tab). */
export async function findChromeMainWindow(): Promise<FocusContext | null> {
  const windows = await listVisibleWindows();
  const chromeWindows = windows.filter(
    (w) =>
      BROWSER_PROCESS.test(w.processName) &&
      CHROME_CLASS.test(w.className ?? ""),
  );

  const waTab = chromeWindows.find((w) => /whatsapp/i.test(w.windowTitle));
  if (waTab?.hwnd) return toFocusContext(waTab);

  const best = chromeWindows[0];
  if (best?.hwnd) {
    console.info(
      `[ripple-desktop] Chrome window: "${best.windowTitle.slice(0, 55)}" (will focus WhatsApp tab)`,
    );
    return {
      ...toFocusContext(best),
      isWhatsApp: false,
    };
  }

  return null;
}

export function isRippleOrEditorWindow(ctx: FocusContext | null): boolean {
  if (!ctx) return true;
  const p = ctx.processName.toLowerCase();
  const t = ctx.windowTitle.toLowerCase();
  return (
    p.includes("electron") ||
    p === "powershell" ||
    t.includes("ripple") ||
    t.includes("cursor") ||
    (t.includes("projectripple") && !t.includes("whatsapp"))
  );
}
