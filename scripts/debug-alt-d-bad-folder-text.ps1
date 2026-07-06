# Capture error dialog text after bad folder Enter.
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System; using System.Runtime.InteropServices;
public class WF2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$badPath = "C:\Users\ANZAL\Downloads\ripple_nonexistent_folder_xyz_999"
function SK([string]$k,[int]$d=150){ [System.Windows.Forms.SendKeys]::SendWait($k); Start-Sleep -ms $d }
function GN { $r=[System.Windows.Automation.AutomationElement]::RootElement; $c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,(Get-Process notepad).Id); $r.FindFirst([System.Windows.Automation.TreeScope]::Children,$c) }
function FN { $w=GN; [void][WF2]::SetForegroundWindow([IntPtr]$w.Current.NativeWindowHandle); Start-Sleep -ms 400 }
function CK { $w=GN; $h=[IntPtr]$w.Current.NativeWindowHandle; $rc=New-Object WF2+RECT; [void][WF2]::GetWindowRect($h,[ref]$rc); $x=[int](($rc.Left+$rc.Right)/2); $y=[int]($rc.Top+($rc.Bottom-$rc.Top)*0.55); [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($x,$y); Start-Sleep -ms 100; Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);' -Name M -Namespace W -EA SilentlyContinue; [W.M]::mouse_event(0x02,0,0,0,0); [W.M]::mouse_event(0x04,0,0,0,0); Start-Sleep -ms 250 }

Get-Process notepad -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep 1
$p = Start-Process notepad -PassThru
Start-Sleep 2
FN; SK "^n"; SK "x"; FN; CK; SK "^+s" 2000
SK "%n"; SK "%d" 400
Set-Clipboard $badPath; SK "^a"; SK "^v" 500; SK "{ENTER}" 2000

$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
Write-Host "=== all named elements in notepad process after bad Enter ==="
foreach ($el in $all) {
  $n = [string]$el.Current.Name
  $t = $el.Current.ControlType.ProgrammaticName
  if ($n -and $n.Length -gt 2 -and $t -match 'Text|Window|Button') {
    Write-Host "  [$t] $n"
  }
}
try { $p | Stop-Process -Force } catch {}
