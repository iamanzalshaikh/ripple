import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  A11yFocusedElement,
  ForegroundWindow,
  VisibleWindow,
  Win32Action,
} from "./types.js";

const execFileAsync = promisify(execFile);

/** P7 — single PowerShell dispatcher for user32 + SendInput + UI Automation. */
const WIN32_DISPATCHER = `
function Ripple-Win32-Dispatch {
param([string]$Action, [string]$JsonArgs)
$ErrorActionPreference = 'Stop'
$args = if ($JsonArgs) { $JsonArgs | ConvertFrom-Json } else { @{} }

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RippleNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@

function Get-ProcName([IntPtr]$h) {
  $windowPid = [uint32]0
  [void][RippleNative]::GetWindowThreadProcessId($h, [ref]$windowPid)
  $proc = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
  if ($proc) { return $proc.ProcessName }
  return ""
}

function Get-Title([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][RippleNative]::GetWindowText($h, $sb, 512)
  return ($sb.ToString() -replace '[\\u0000-\\u001F\\u007F]', ' ').Trim()
}

function Focus-Hwnd([IntPtr]$h, [string]$titleHint) {
  [void][RippleNative]::AllowSetForegroundWindow(-1)
  $ws = New-Object -ComObject WScript.Shell
  if ($titleHint) { $null = $ws.AppActivate($titleHint) }
  if ([RippleNative]::IsIconic($h)) { [void][RippleNative]::ShowWindow($h, 9) }
  [void][RippleNative]::BringWindowToTop($h)
  $fg = [RippleNative]::GetForegroundWindow()
  $fgPid = [uint32]0; $targetPid = [uint32]0
  $fgThread = [RippleNative]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $targetThread = [RippleNative]::GetWindowThreadProcessId($h, [ref]$targetPid)
  if ($fgThread -ne 0 -and $targetThread -ne 0) {
    [void][RippleNative]::AttachThreadInput($fgThread, $targetThread, $true)
  }
  [void][RippleNative]::SetForegroundWindow($h)
  if ($fgThread -ne 0 -and $targetThread -ne 0) {
    [void][RippleNative]::AttachThreadInput($fgThread, $targetThread, $false)
  }
}

switch ($Action) {
  'getForeground' {
    $h = [RippleNative]::GetForegroundWindow()
  @{ hwnd = [int64]$h; processName = (Get-ProcName $h); windowTitle = (Get-Title $h) } | ConvertTo-Json -Compress
  }
  'focusHwnd' {
    $h = [IntPtr][int64]$args.hwnd
    Focus-Hwnd $h ([string]$args.titleHint)
    @{ ok = $true; hwnd = [int64]$h } | ConvertTo-Json -Compress
  }
  'closeHwnd' {
    $h = [IntPtr][int64]$args.hwnd
    [void][RippleNative]::SendMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    @{ ok = $true } | ConvertTo-Json -Compress
  }
  'minimizeAll' {
    $count = 0
    Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
      if ([RippleNative]::ShowWindow($_.MainWindowHandle, 6)) { $count++ }
    }
    @{ count = $count } | ConvertTo-Json -Compress
  }
  'enumWindows' {
    $list = New-Object System.Collections.Generic.List[object]
    $cb = [RippleNative+EnumWindowsProc]{
      param($hWnd, $lParam)
      if (-not [RippleNative]::IsWindowVisible($hWnd)) { return $true }
      $title = Get-Title $hWnd
      if ([string]::IsNullOrWhiteSpace($title)) { return $true }
      $classSb = New-Object System.Text.StringBuilder 256
      [void][RippleNative]::GetClassName($hWnd, $classSb, 256)
      $list.Add([pscustomobject]@{
        hwnd = [int64]$hWnd
        processName = (Get-ProcName $hWnd)
        windowTitle = $title
        className = $classSb.ToString()
      }) | Out-Null
      return $true
    }
    [void][RippleNative]::EnumWindows($cb, [IntPtr]::Zero)
    $list | ConvertTo-Json -Compress
  }
  'sendKeys' {
    if ($args.hwnd) {
      Focus-Hwnd ([IntPtr][int64]$args.hwnd) ([string]$args.titleHint)
      Start-Sleep -Milliseconds ($(if ($null -ne $args.delayMs) { [int]$args.delayMs } else { 300 }))
    }
    if ($args.text) {
      Set-Clipboard -Value ([string]$args.text)
      [System.Windows.Forms.SendKeys]::SendWait('^v')
    } elseif ($args.keys) {
      [System.Windows.Forms.SendKeys]::SendWait([string]$args.keys)
    }
    $fg = [RippleNative]::GetForegroundWindow()
    @{ ok = $true; foregroundHwnd = [int64]$fg; foregroundTitle = (Get-Title $fg) } | ConvertTo-Json -Compress
  }
  'runSequence' {
    if ($args.hwnd) {
      Focus-Hwnd ([IntPtr][int64]$args.hwnd) ([string]$args.titleHint)
      Start-Sleep -Milliseconds ($(if ($null -ne $args.delayMs) { [int]$args.delayMs } else { 300 }))
    }
    foreach ($step in $args.steps) {
      if ($step.type -eq 'text') {
        Set-Clipboard -Value ([string]$step.value)
        [System.Windows.Forms.SendKeys]::SendWait('^v')
      } elseif ($step.type -eq 'keys') {
        [System.Windows.Forms.SendKeys]::SendWait([string]$step.value)
      }
      if ($step.delayMs) { Start-Sleep -Milliseconds ([int]$step.delayMs) }
    }
    $fg = [RippleNative]::GetForegroundWindow()
    $target = if ($args.hwnd) { [int64][IntPtr][int64]$args.hwnd } else { [int64]$fg }
    @{ ok = ($fg -eq [IntPtr]$target); foregroundHwnd = [int64]$fg; foregroundTitle = (Get-Title $fg) } | ConvertTo-Json -Compress
  }
  'getFocusedA11y' {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    if (-not $el) { '{}' | Write-Output; break }
    @{
      name = $el.Current.Name
      controlType = $el.Current.ControlType.ProgrammaticName
      automationId = $el.Current.AutomationId
      className = $el.Current.ClassName
    } | ConvertTo-Json -Compress
  }
  default { throw "Unknown action: $Action" }
}
}
`.trim();

function buildWin32Script(action: Win32Action, jsonArgs: string): string {
  const safeAction = action.replace(/'/g, "''");
  const safeJson = jsonArgs.replace(/'/g, "''");
  return `${WIN32_DISPATCHER}; Ripple-Win32-Dispatch -Action '${safeAction}' -JsonArgs '${safeJson}'`;
}

function parseJsonOutput<T>(stdout: string): T {
  const line = stdout.trim().split(/\r?\n/).pop() ?? "{}";
  const sanitized = line.replace(/[\u0001-\u001F\u007F]/g, " ").replace(/\u0000/g, " ");
  return JSON.parse(sanitized || "{}") as T;
}

export function isWin32NativeAvailable(): boolean {
  return process.platform === "win32";
}

export async function invokeWin32<T>(
  action: Win32Action,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!isWin32NativeAvailable()) {
    throw new Error(`Win32 native action "${action}" requires Windows`);
  }

  const jsonArgs = JSON.stringify(args);
  const script = buildWin32Script(action, jsonArgs);
  const { stdout, stderr } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-STA", "-Command", script],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );

  if (stderr?.trim()) {
    console.warn(`[ripple-native] ${action} stderr:`, stderr.slice(0, 200));
  }

  return parseJsonOutput<T>(stdout);
}

export async function getForegroundWindow(): Promise<ForegroundWindow | null> {
  if (!isWin32NativeAvailable()) return null;
  try {
    const row = await invokeWin32<ForegroundWindow>("getForeground");
    return row?.hwnd ? row : null;
  } catch (e: unknown) {
    console.warn(
      "[ripple-native] getForeground failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

export async function focusWindowByHwnd(
  hwnd: number,
  titleHint?: string,
): Promise<void> {
  await invokeWin32("focusHwnd", { hwnd, titleHint });
}

export async function closeWindowByHwnd(hwnd: number): Promise<void> {
  await invokeWin32("closeHwnd", { hwnd });
}

export async function minimizeAllWindowsNative(): Promise<number> {
  const res = await invokeWin32<{ count: number }>("minimizeAll");
  return res.count ?? 0;
}

export async function listVisibleWindowsNative(): Promise<VisibleWindow[]> {
  if (!isWin32NativeAvailable()) return [];
  try {
    const parsed = await invokeWin32<VisibleWindow | VisibleWindow[]>("enumWindows");
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch (e: unknown) {
    console.warn(
      "[ripple-native] enumWindows failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

export async function sendKeysNative(args: {
  hwnd?: number;
  titleHint?: string;
  keys?: string;
  text?: string;
  delayMs?: number;
}): Promise<{ ok: boolean; foregroundHwnd?: number; foregroundTitle?: string }> {
  return invokeWin32("sendKeys", args);
}

export type InputSequenceStep =
  | { type: "keys"; value: string; delayMs?: number }
  | { type: "text"; value: string; delayMs?: number };

export async function runInputSequenceNative(args: {
  hwnd?: number;
  titleHint?: string;
  delayMs?: number;
  steps: InputSequenceStep[];
}): Promise<{ ok: boolean; foregroundHwnd?: number; foregroundTitle?: string }> {
  return invokeWin32("runSequence", args);
}

export async function getFocusedA11yElement(): Promise<A11yFocusedElement | null> {
  if (!isWin32NativeAvailable()) return null;
  try {
    const el = await invokeWin32<A11yFocusedElement>("getFocusedA11y");
    if (!el?.name && !el?.controlType) return null;
    return el;
  } catch (e: unknown) {
    console.warn(
      "[ripple-native] a11y focus failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
