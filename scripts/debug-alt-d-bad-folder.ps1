# Alt+D + paste nonexistent folder + Enter — what does the dialog do?
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

$badPath = "C:\Users\ANZAL\Downloads\ripple_nonexistent_folder_xyz_999"

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
    value        = $value
  }
  return ($obj | ConvertTo-Json -Compress)
}

function Get-FgWindowTitle {
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if (-not $el) { return "?" }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $w = $el
  while ($w -and $w.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
    $w = $walker.GetParent($w)
  }
  if ($w) { return [string]$w.Current.Name }
  return "?"
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
  Add-Type -MemberDefinition $sig -Name MouseEv5 -Namespace Win32e -ErrorAction SilentlyContinue
  [Win32e.MouseEv5]::mouse_event(0x02, 0, 0, 0, 0)
  [Win32e.MouseEv5]::mouse_event(0x04, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 300
}

Write-Host "=== bad folder path test: $badPath ==="

Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$np = Start-Process notepad.exe -PassThru
Start-Sleep -Seconds 2

$win = Focus-Notepad
Send-Keys "^n" 400
Send-Keys "bad path test" 400
$win = Focus-Notepad
Click-NotepadBody $win
Send-Keys "^+s" 2000

Write-Host "=== save open: $(Get-FocusedA11yJson) ==="

Send-Keys "%n" 300
Send-Keys "%d" 400
Write-Host "=== address edit before paste: $(Get-FocusedA11yJson) ==="

Set-Clipboard -Value $badPath
Send-Keys "^a" 120
Send-Keys "^v" 500
Write-Host "=== after paste bad path: $(Get-FocusedA11yJson) ==="

Send-Keys "{ENTER}" 1200
Write-Host "=== after Enter (+1.2s): window=$(Get-FgWindowTitle) a11y=$(Get-FocusedA11yJson) ==="

Start-Sleep -Milliseconds 1500
Write-Host "=== after Enter (+2.7s total): window=$(Get-FgWindowTitle) a11y=$(Get-FocusedA11yJson) ==="

# Scan for error dialog / message
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty,
  "Save as"
)
$saveWin = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($saveWin) {
  $textCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text
  )
  $texts = $saveWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond)
  Write-Host "=== Text elements in Save as window: $($texts.Count) ==="
  foreach ($t in $texts) {
    $n = [string]$t.Current.Name
    if ($n) { Write-Host "  TEXT: $n" }
  }
}

# Check address toolbar name after failed navigate
Send-Keys "%d" 400
Write-Host "=== address after re-Alt+D: $(Get-FocusedA11yJson) ==="

Write-Host "=== done ==="
try { $np | Stop-Process -Force } catch {}
