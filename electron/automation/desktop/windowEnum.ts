import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VisibleWindow {
  hwnd: number;
  processName: string;
  windowTitle: string;
  className: string;
}

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

export async function listVisibleWindows(): Promise<VisibleWindow[]> {
  if (process.platform !== "win32") return [];

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", ENUM_WINDOWS_SCRIPT],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as VisibleWindow | VisibleWindow[];
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] window enum failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
