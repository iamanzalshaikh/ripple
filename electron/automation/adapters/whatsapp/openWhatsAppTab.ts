import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { releaseDesktopFocus } from "../../releaseDesktopFocus.js";
import { delay } from "../../delay.js";

const execFileAsync = promisify(execFile);

/**
 * Focus Chrome and switch to WhatsApp via tab search (Ctrl+Shift+A).
 */
export async function focusWhatsAppTabInChrome(
  hwnd: number,
  windowTitle: string,
): Promise<void> {
  if (process.platform !== "win32" || !hwnd) return;

  releaseDesktopFocus();
  await delay(200);

  const titleHint = (windowTitle || "Chrome").slice(0, 80).replace(/'/g, "''");

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RippleWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
}
"@
[void][RippleWin]::AllowSetForegroundWindow(-1)
$ws = New-Object -ComObject WScript.Shell
$null = $ws.AppActivate('${titleHint}')
if (-not $?) { $null = $ws.AppActivate('Chrome') }
$h = [IntPtr]${hwnd}
if ([RippleWin]::IsIconic($h)) { [void][RippleWin]::ShowWindow($h, 9) }
[void][RippleWin]::BringWindowToTop($h)
[void][RippleWin]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 700
[System.Windows.Forms.SendKeys]::SendWait('^+a')
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('WhatsApp')
Start-Sleep -Milliseconds 600
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`.trim();

  await execFileAsync(
    "powershell",
    ["-NoProfile", "-STA", "-Command", script],
    { windowsHide: true },
  );

  await delay(2000);
  console.info("[ripple-desktop] Focused WhatsApp tab via Chrome tab search");
}

/** Open web.whatsapp.com in a new Chrome tab when tab search did not work. */
export async function openWhatsAppNewTabInChrome(
  hwnd: number,
  windowTitle: string,
): Promise<void> {
  if (process.platform !== "win32" || !hwnd) return;

  releaseDesktopFocus();
  await delay(200);

  const titleHint = (windowTitle || "Chrome").slice(0, 80).replace(/'/g, "''");

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int d);
}
"@
[void][W]::AllowSetForegroundWindow(-1)
$ws = New-Object -ComObject WScript.Shell
$null = $ws.AppActivate('${titleHint}')
$h = [IntPtr]${hwnd}
if ([W]::IsIconic($h)) { [void][W]::ShowWindow($h, 9) }
[void][W]::BringWindowToTop($h)
[void][W]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 600
[System.Windows.Forms.SendKeys]::SendWait('^t')
Start-Sleep -Milliseconds 350
[System.Windows.Forms.SendKeys]::SendWait('https://web.whatsapp.com')
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`.trim();

  await execFileAsync(
    "powershell",
    ["-NoProfile", "-STA", "-Command", script],
    { windowsHide: true },
  );

  await delay(4000);
  console.info("[ripple-desktop] Opened web.whatsapp.com in new Chrome tab");
}
