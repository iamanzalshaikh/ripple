# Diagnostic: Tab-hunt from Win11 Notepad Save As (post Ctrl+Shift+S only).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

function Get-FocusedA11yJson {
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if (-not $el) { return "null" }
  $value = ""
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp) { $value = [string]$vp.Current.Value }
  } catch {}
  $obj = [ordered]@{
    name         = [string]$el.Current.Name
    controlType  = $el.Current.ControlType.ProgrammaticName
    automationId = [string]$el.Current.AutomationId
    className    = [string]$el.Current.ClassName
    value        = $value
  }
  return ($obj | ConvertTo-Json -Compress)
}

function Send-Keys([string]$keys, [int]$delayMs = 150) {
  [System.Windows.Forms.SendKeys]::SendWait($keys)
  Start-Sleep -Milliseconds $delayMs
}

function Get-NotepadWindow {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    (Get-Process notepad -ErrorAction Stop | Select-Object -First 1).Id
  )
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}

function Focus-Notepad {
  $win = Get-NotepadWindow
  if (-not $win) { throw "notepad window not found" }
  $hwnd = [IntPtr]$win.Current.NativeWindowHandle
  [void][WinFocus]::ShowWindow($hwnd, 9)
  [void][WinFocus]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 400
  return $win
}

function Click-NotepadBody($win) {
  $hwnd = [IntPtr]$win.Current.NativeWindowHandle
  $rect = New-Object WinFocus+RECT
  [void][WinFocus]::GetWindowRect($hwnd, [ref]$rect)
  $x = [int](($rect.Left + $rect.Right) / 2)
  $y = [int]($rect.Top + ($rect.Bottom - $rect.Top) * 0.55)
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
  Start-Sleep -Milliseconds 100
  $sig = @"
[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
"@
  Add-Type -MemberDefinition $sig -Name MouseEv -Namespace Win32 -ErrorAction SilentlyContinue
  [Win32.MouseEv]::mouse_event(0x02, 0, 0, 0, 0)
  [Win32.MouseEv]::mouse_event(0x04, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 250
}

Write-Host "=== debug-inline-save-tab-hunt ==="
Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
$np = Start-Process notepad.exe -PassThru
Start-Sleep -Seconds 2

$win = Focus-Notepad
Send-Keys "^n" 400
Send-Keys "ripple tab hunt test" 400
$win = Focus-Notepad
Click-NotepadBody $win
Send-Keys "^+s" 2000

$win = Get-NotepadWindow
Write-Host "=== notepad title after ^+s: $($win.Current.Name) ==="
Write-Host "=== focused before tab-hunt (filename should be here): $(Get-FocusedA11yJson) ==="

# Mirror trySetInlineSaveFolder: Alt+N then Tab loop
Send-Keys "%n" 300
Write-Host "=== after Alt+N i=pre: $(Get-FocusedA11yJson) ==="

for ($i = 0; $i -lt 10; $i++) {
  Send-Keys "{TAB}" 150
  $json = Get-FocusedA11yJson
  Write-Host "[ripple-desktop] save folder tab-hunt i=$i a11y=$json"
}

Write-Host "=== done ==="
try { $np | Stop-Process -Force } catch {}
