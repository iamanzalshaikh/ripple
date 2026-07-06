# Alt+D behavior from multiple focus states in Win11 Notepad Save As.
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
  Add-Type -MemberDefinition $sig -Name MouseEv4 -Namespace Win32d -ErrorAction SilentlyContinue
  [Win32d.MouseEv4]::mouse_event(0x02, 0, 0, 0, 0)
  [Win32d.MouseEv4]::mouse_event(0x04, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 300
}

function Test-AltD([string]$label, [scriptblock]$SetupFocus) {
  Write-Host ""
  Write-Host "========== SCENARIO: $label =========="
  Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  $np = Start-Process notepad.exe -PassThru
  Start-Sleep -Seconds 2
  $win = Focus-Notepad
  Send-Keys "^n" 400
  Send-Keys "alt-d test" 400
  $win = Focus-Notepad
  Click-NotepadBody $win
  Send-Keys "^+s" 2000

  & $SetupFocus

  Write-Host "--- BEFORE Alt+D ---"
  Write-Host "  window: $(Get-FgWindowTitle)"
  Write-Host "  a11y:   $(Get-FocusedA11yJson)"
  Send-Keys "%d" 400
  Write-Host "--- AFTER Alt+D ---"
  Write-Host "  window: $(Get-FgWindowTitle)"
  Write-Host "  a11y:   $(Get-FocusedA11yJson)"
  $after = Get-FocusedA11yJson
  $isInlineEdit = $after -match '"name":"Address"' -and $after -match 'ControlType.Edit'
  $isExplorer = $after -match '"process":"explorer"' -or (Get-FgWindowTitle) -match 'File Explorer'
  if ($isInlineEdit) { Write-Host "  RESULT: inline Address Edit (OK)" }
  elseif ($isExplorer) { Write-Host "  RESULT: EXPLORER WINDOW (BAD)" }
  else { Write-Host "  RESULT: other/unexpected" }
  try { $np | Stop-Process -Force } catch {}
}

# A: immediately after ^+s — no Alt+N, no extra tabs (natural post-save focus)
Test-AltD "A: right after Ctrl+Shift+S (no Alt+N)" {
  Start-Sleep -Milliseconds 200
}

# B: after Alt+N (filename explicitly focused — Test B from prior run)
Test-AltD "B: after Alt+N (filename field)" {
  Send-Keys "%n" 350
}

# C: after 1 Tab from filename (Save as type combobox)
Test-AltD "C: after Alt+N + 1 Tab (save type)" {
  Send-Keys "%n" 300
  Send-Keys "{TAB}" 180
}

# D: after 6 Tabs (address/up band toolbar area)
Test-AltD "D: after Alt+N + 6 Tabs (toolbar band)" {
  Send-Keys "%n" 300
  for ($i = 0; $i -lt 6; $i++) { Send-Keys "{TAB}" 180 }
}

# E: after Tab to Save button (3 tabs from filename per prior hunt)
Test-AltD "E: after Alt+N + 3 Tabs (Save button)" {
  Send-Keys "%n" 300
  for ($i = 0; $i -lt 3; $i++) { Send-Keys "{TAB}" 180 }
}

# F: ^+s WITHOUT body click first (focus may differ)
Test-AltD "F: Ctrl+Shift+S without pre-click, then Alt+D immediate" {
  # re-open without click - override setup in wrapper... use custom block
}

Write-Host ""
Write-Host "========== SCENARIO F-custom: no body click =========="
Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$np2 = Start-Process notepad.exe -PassThru
Start-Sleep -Seconds 2
Focus-Notepad | Out-Null
Send-Keys "^n" 400
Send-Keys "no click test" 400
Focus-Notepad | Out-Null
# NO body click
Send-Keys "^+s" 2000
Write-Host "--- BEFORE Alt+D (no pre-click) ---"
Write-Host "  window: $(Get-FgWindowTitle)"
Write-Host "  a11y:   $(Get-FocusedA11yJson)"
Send-Keys "%d" 400
Write-Host "--- AFTER Alt+D ---"
Write-Host "  window: $(Get-FgWindowTitle)"
Write-Host "  a11y:   $(Get-FocusedA11yJson)"
try { $np2 | Stop-Process -Force } catch {}

Write-Host ""
Write-Host "=== all scenarios done ==="
