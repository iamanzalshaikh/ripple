import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  A11yFocusedElement,
  ForegroundWindow,
  ScreenshotOcrResult,
  VisibleWindow,
  Win32Action,
} from "./types.js";
import {
  callNativeRpc,
  getSidecarCapabilities,
  isNativeClientAuthenticated,
} from "./nativeClient.js";

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
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT Point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
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
  'getScreenMetrics' {
    @{ width = [RippleNative]::GetSystemMetrics(0); height = [RippleNative]::GetSystemMetrics(1) } | ConvertTo-Json -Compress
  }
  'getWindowAtPoint' {
    $pt = New-Object RippleNative+POINT
    $pt.X = [int]$args.x
    $pt.Y = [int]$args.y
    $h = [RippleNative]::WindowFromPoint($pt)
    if ($h -eq [IntPtr]::Zero) { '{}' | Write-Output; break }
    $root = [RippleNative]::GetAncestor($h, 2)
    if ($root -ne [IntPtr]::Zero) { $h = $root }
    $mon = [RippleNative]::MonitorFromPoint($pt, 2)
    @{
      hwnd = [int64]$h
      processName = (Get-ProcName $h)
      windowTitle = (Get-Title $h)
      monitorHandle = [int64]$mon
    } | ConvertTo-Json -Compress
  }
  'getCursorPosition' {
    $p = [System.Windows.Forms.Cursor]::Position
    @{ ok = $true; x = $p.X; y = $p.Y } | ConvertTo-Json -Compress
  }
  'mouseMove' {
    [void][RippleNative]::SetCursorPos([int]$args.x, [int]$args.y)
    @{ ok = $true; x = [int]$args.x; y = [int]$args.y } | ConvertTo-Json -Compress
  }
  'mouseClick' {
    [void][RippleNative]::SetCursorPos([int]$args.x, [int]$args.y)
    $btn = if ($args.button) { [string]$args.button } else { 'left' }
    $down = switch ($btn.ToLower()) { 'right' { 0x0008 } 'middle' { 0x0020 } default { 0x0002 } }
    $up = switch ($btn.ToLower()) { 'right' { 0x0010 } 'middle' { 0x0040 } default { 0x0004 } }
    [RippleNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    [RippleNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    if ($args.double) {
      Start-Sleep -Milliseconds 50
      [RippleNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
      [RippleNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    }
    @{ ok = $true; x = [int]$args.x; y = [int]$args.y } | ConvertTo-Json -Compress
  }
  'mouseScroll' {
    [void][RippleNative]::SetCursorPos([int]$args.x, [int]$args.y)
    $delta = [int]$args.delta
    $flags = if ($args.horizontal) { 0x1000 } else { 0x0800 }
    [RippleNative]::mouse_event($flags, 0, 0, [uint32][int32]$delta, [UIntPtr]::Zero)
    @{ ok = $true; x = [int]$args.x; y = [int]$args.y } | ConvertTo-Json -Compress
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

  if (isNativeClientAuthenticated()) {
    try {
      const row = (await callNativeRpc("get_foreground", {})) as ForegroundWindow;
      return row?.hwnd ? row : null;
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] get_foreground RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

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
  if (isNativeClientAuthenticated()) {
    try {
      await callNativeRpc("focus_window", { hwnd, titleHint });
      return;
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] focus_window RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  await invokeWin32("focusHwnd", { hwnd, titleHint });
}

export async function closeWindowByHwnd(hwnd: number): Promise<void> {
  if (isNativeClientAuthenticated()) {
    try {
      await callNativeRpc("close_window", { hwnd });
      return;
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] close_window RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  await invokeWin32("closeHwnd", { hwnd });
}

export async function minimizeAllWindowsNative(): Promise<number> {
  const res = await invokeWin32<{ count: number }>("minimizeAll");
  return res.count ?? 0;
}

export async function listVisibleWindowsNative(): Promise<VisibleWindow[]> {
  if (!isWin32NativeAvailable()) return [];

  if (isNativeClientAuthenticated()) {
    try {
      const rows = (await callNativeRpc("list_windows", {})) as VisibleWindow[];
      return Array.isArray(rows) ? rows : [];
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] list_windows RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

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
  if (
    isNativeClientAuthenticated() &&
    getSidecarCapabilities()?.sendInput === true
  ) {
    try {
      return (await callNativeRpc("send_keys", args)) as {
        ok: boolean;
        foregroundHwnd?: number;
        foregroundTitle?: string;
      };
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] send_keys RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
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
  if (
    isNativeClientAuthenticated() &&
    getSidecarCapabilities()?.sendInput === true
  ) {
    try {
      return (await callNativeRpc("run_input_sequence", args)) as {
        ok: boolean;
        foregroundHwnd?: number;
        foregroundTitle?: string;
      };
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] run_input_sequence RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return invokeWin32("runSequence", args);
}

export async function getFocusedA11yElement(): Promise<A11yFocusedElement | null> {
  if (!isWin32NativeAvailable()) return null;

  if (
    isNativeClientAuthenticated() &&
    getSidecarCapabilities()?.uia === true
  ) {
    try {
      const el = (await callNativeRpc("get_focused_a11y", {})) as A11yFocusedElement;
      if (!el?.name && !el?.controlType) return null;
      return el;
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] get_focused_a11y RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

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

export async function screenshotOcrNative(args: {
  hwnd?: number;
} = {}): Promise<ScreenshotOcrResult | null> {
  if (!isWin32NativeAvailable()) return null;

  if (
    isNativeClientAuthenticated() &&
    getSidecarCapabilities()?.ocr === true
  ) {
    try {
      return (await callNativeRpc("screenshot_ocr", args)) as ScreenshotOcrResult;
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] screenshot_ocr RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return null;
}

export async function getWindowRectCenter(
  hwnd: number,
): Promise<{ x: number; y: number } | null> {
  if (!isWin32NativeAvailable() || !hwnd) return null;
  if (isNativeClientAuthenticated() && getSidecarCapabilities()?.windowOps === true) {
    try {
      const rect = (await callNativeRpc("get_window_rect", { hwnd })) as {
        centerX?: number;
        centerY?: number;
      };
      if (typeof rect?.centerX === "number" && typeof rect?.centerY === "number") {
        return { x: rect.centerX, y: rect.centerY };
      }
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] get_window_rect RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return null;
}

export type WindowAtPointResult = ForegroundWindow & {
  monitorHandle?: number;
};

/** Top-level window at screen coordinates (PowerShell / user32). */
export async function getWindowAtPointNative(
  x: number,
  y: number,
): Promise<WindowAtPointResult | null> {
  if (!isWin32NativeAvailable()) return null;
  try {
    const raw = await invokeWin32<{
      hwnd?: number;
      processName?: string;
      windowTitle?: string;
      monitorHandle?: number;
    }>("getWindowAtPoint", { x, y });
    if (!raw?.hwnd) return null;
    return {
      hwnd: Number(raw.hwnd),
      processName: raw.processName ?? "",
      windowTitle: raw.windowTitle ?? "",
      monitorHandle:
        typeof raw.monitorHandle === "number" ? raw.monitorHandle : undefined,
    };
  } catch (e: unknown) {
    console.warn(
      "[ripple-win32] getWindowAtPoint failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return null;
}

/** Window under the physical mouse cursor (hybrid targeting aid). */
export async function getWindowUnderCursorNative(): Promise<WindowAtPointResult | null> {
  const pos = await getCursorPositionNative();
  if (!pos) return null;
  return getWindowAtPointNative(pos.x, pos.y);
}

/** Primary monitor center via GetSystemMetrics (works without native sidecar). */
export async function getPrimaryScreenCenter(): Promise<{ x: number; y: number } | null> {
  if (!isWin32NativeAvailable()) return null;
  try {
    const m = await invokeWin32<{ width: number; height: number }>("getScreenMetrics", {});
    if (typeof m?.width === "number" && typeof m?.height === "number" && m.width > 0 && m.height > 0) {
      return { x: Math.round(m.width / 2), y: Math.round(m.height / 2) };
    }
  } catch (e: unknown) {
    console.warn(
      "[ripple-win32] getScreenMetrics failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return null;
}

/** Screen center fallback when HWND rect is unavailable. */
export async function getWindowCenterNative(): Promise<{ x: number; y: number } | null> {
  const fg = await getForegroundWindow();
  if (fg?.hwnd) {
    const c = await getWindowRectCenter(fg.hwnd);
    if (c) return c;
  }
  return getPrimaryScreenCenter();
}

export async function mouseClickNative(args: {
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  double?: boolean;
}): Promise<{ ok: boolean; x: number; y: number } | null> {
  if (!isWin32NativeAvailable()) return null;
  if (isNativeClientAuthenticated() && getSidecarCapabilities()?.mouse === true) {
    try {
      return (await callNativeRpc("mouse_click", args)) as {
        ok: boolean;
        x: number;
        y: number;
      };
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] mouse_click RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  try {
    return await invokeWin32<{ ok: boolean; x: number; y: number }>("mouseClick", args);
  } catch (e: unknown) {
    console.warn(
      "[ripple-win32] mouseClick fallback failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return null;
}

export async function mouseScrollNative(args: {
  x: number;
  y: number;
  delta: number;
  horizontal?: boolean;
}): Promise<{ ok: boolean; x: number; y: number } | null> {
  if (!isWin32NativeAvailable()) return null;
  if (isNativeClientAuthenticated() && getSidecarCapabilities()?.mouse === true) {
    try {
      return (await callNativeRpc("mouse_scroll", args)) as {
        ok: boolean;
        x: number;
        y: number;
      };
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] mouse_scroll RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  try {
    return await invokeWin32<{ ok: boolean; x: number; y: number }>("mouseScroll", args);
  } catch (e: unknown) {
    console.warn(
      "[ripple-win32] mouseScroll fallback failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return null;
}

export async function mouseDragNative(args: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  button?: "left" | "right" | "middle";
}): Promise<{ ok: boolean; x: number; y: number } | null> {
  if (!isWin32NativeAvailable()) return null;
  if (isNativeClientAuthenticated() && getSidecarCapabilities()?.mouse === true) {
    try {
      return (await callNativeRpc("mouse_drag", args)) as {
        ok: boolean;
        x: number;
        y: number;
      };
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] mouse_drag RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return null;
}

export async function mouseMoveNative(args: {
  x: number;
  y: number;
}): Promise<{ ok: boolean; x: number; y: number } | null> {
  if (!isWin32NativeAvailable()) return null;
  if (isNativeClientAuthenticated() && getSidecarCapabilities()?.mouse === true) {
    try {
      return (await callNativeRpc("mouse_move", args)) as {
        ok: boolean;
        x: number;
        y: number;
      };
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] mouse_move RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  try {
    return await invokeWin32<{ ok: boolean; x: number; y: number }>("mouseMove", args);
  } catch (e: unknown) {
    console.warn(
      "[ripple-win32] mouseMove fallback failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return null;
}

export async function getCursorPositionNative(): Promise<{
  ok: boolean;
  x: number;
  y: number;
} | null> {
  if (!isWin32NativeAvailable()) return null;
  if (isNativeClientAuthenticated() && getSidecarCapabilities()?.mouse === true) {
    try {
      return (await callNativeRpc("get_cursor_position", {})) as {
        ok: boolean;
        x: number;
        y: number;
      };
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] get_cursor_position RPC failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  try {
    return await invokeWin32<{ ok: boolean; x: number; y: number }>("getCursorPosition", {});
  } catch (e: unknown) {
    console.warn(
      "[ripple-win32] getCursorPosition fallback failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return null;
}
