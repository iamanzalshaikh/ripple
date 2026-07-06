# Paste test at Address toolbar (i=6) - same flow as successful tab-hunt run.
$ErrorActionPreference = "Continue"
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
  $procName = "?"
  try { $procName = (Get-Process -Id $el.Current.ProcessId).ProcessName } catch {}
  $obj = [ordered]@{
    process      = $procName
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
  $hwnd = [IntPtr]$win.Current.NativeWindowHandle
  [void][WinFocus]::ShowWindow($hwnd, 9)
  [void][WinFocus]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 500
  return $win
}

function Click-NotepadBody($win) {
  $hwnd = [IntPtr]$win.Current.NativeWindowHandle
  $rect = New-Object WinFocus+RECT
  [void][WinFocus]::GetWindowRect($hwnd, [ref]$rect)
  $x = [int](($rect.Left + $rect.Right) / 2)
  $y = [int]($rect.Top + ($rect.Bottom - $rect.Top) * 0.55)
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
  Start-Sleep -Milliseconds 150
  $sig = @"
[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
"@
  Add-Type -MemberDefinition $sig -Name MouseEv3 -Namespace Win32c -ErrorAction SilentlyContinue
  [Win32c.MouseEv3]::mouse_event(0x02, 0, 0, 0, 0)
  [Win32c.MouseEv3]::mouse_event(0x04, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 300
}

$desktopPath = [Environment]::GetFolderPath("Desktop")
Write-Host "=== address-toolbar paste test (paste: $desktopPath) ==="

Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$np = Start-Process notepad.exe -PassThru
Start-Sleep -Seconds 2

$win = Focus-Notepad
Send-Keys "^n" 400
Send-Keys "paste test only" 400
$win = Focus-Notepad
Click-NotepadBody $win
Send-Keys "^+s" 2000

Write-Host "=== post ^+s title: $((Get-NotepadWindow).Current.Name) ==="
Write-Host "=== post ^+s focus: $(Get-FocusedA11yJson) ==="

Send-Keys "%n" 300
for ($i = 0; $i -lt 6; $i++) { Send-Keys "{TAB}" 180 }

Write-Host "=== i=6 BEFORE paste: $(Get-FocusedA11yJson) ==="

Set-Clipboard -Value $desktopPath
Send-Keys "^a" 120
Send-Keys "^v" 500
Write-Host "=== i=6 AFTER ^a^v (immediate): $(Get-FocusedA11yJson) ==="

Start-Sleep -Milliseconds 800
Write-Host "=== i=6 AFTER ^a^v (+800ms): $(Get-FocusedA11yJson) ==="

# Also test Alt+D (Explorer address-bar edit mode) from filename field
Focus-Notepad | Out-Null
Send-Keys "%n" 300
Write-Host "=== reset to filename, then Alt+D: $(Get-FocusedA11yJson) ==="
Send-Keys "%d" 400
Write-Host "=== after Alt+D from filename: $(Get-FocusedA11yJson) ==="
Set-Clipboard -Value $desktopPath
Send-Keys "^a" 120
Send-Keys "^v" 500
Write-Host "=== after Alt+D + ^v: $(Get-FocusedA11yJson) ==="
Send-Keys "{ENTER}" 1000
Write-Host "=== after Alt+D paste + Enter: $(Get-FocusedA11yJson) ==="
Send-Keys "%n" 300
Write-Host "=== after Alt+N back to filename: $(Get-FocusedA11yJson) ==="

Write-Host "=== done ==="
try { $np | Stop-Process -Force } catch {}
