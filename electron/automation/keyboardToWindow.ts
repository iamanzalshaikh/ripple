import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { releaseDesktopFocus } from "./releaseDesktopFocus.js";

const execFileAsync = promisify(execFile);

export interface WhatsAppKeysResult {
  ok: boolean;
  foregroundTitle?: string;
  error?: string;
}

function toBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/**
 * WhatsApp Web: focus Chrome → Ctrl+Alt+Shift+F (search) → paste contact → Enter → paste message.
 * Clipboard + keyboard only (no mouse — DPI/layout broke clicks).
 */
export async function runWhatsAppKeysOnWindow(
  hwnd: number,
  windowTitle: string,
  contact: string,
  message: string,
  send: boolean,
): Promise<WhatsAppKeysResult> {
  if (process.platform !== "win32" || !hwnd) {
    throw new Error("runWhatsAppKeysOnWindow requires a valid hwnd on Windows");
  }

  releaseDesktopFocus();
  await new Promise((r) => setTimeout(r, 250));

  const titleHint = (windowTitle || "WhatsApp").slice(0, 80).replace(/'/g, "''");
  const contactB64 = toBase64(contact);
  const messageB64 = toBase64(message);
  const sendStep = send
    ? "Start-Sleep -Milliseconds 250; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"
    : "";

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RippleWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@
function Focus-Target([IntPtr]$h, [string]$titleHint) {
  [void][RippleWin]::AllowSetForegroundWindow(-1)
  $ws = New-Object -ComObject WScript.Shell
  if ($titleHint) { $null = $ws.AppActivate($titleHint) }
  if (-not $?) { $null = $ws.AppActivate('WhatsApp') }
  if ([RippleWin]::IsIconic($h)) { [void][RippleWin]::ShowWindow($h, 9) }
  [void][RippleWin]::BringWindowToTop($h)
  $fg = [RippleWin]::GetForegroundWindow()
  $fgProcId = [uint32]0
  $targetProcId = [uint32]0
  $fgThread = [RippleWin]::GetWindowThreadProcessId($fg, [ref]$fgProcId)
  $targetThread = [RippleWin]::GetWindowThreadProcessId($h, [ref]$targetProcId)
  if ($fgThread -ne 0 -and $targetThread -ne 0) {
    [void][RippleWin]::AttachThreadInput($fgThread, $targetThread, $true)
  }
  [void][RippleWin]::SetForegroundWindow($h)
  if ($fgThread -ne 0 -and $targetThread -ne 0) {
    [void][RippleWin]::AttachThreadInput($fgThread, $targetThread, $false)
  }
  Start-Sleep -Milliseconds 800
}
$h = [IntPtr]${hwnd}
$contact = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${contactB64}'))
$message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${messageB64}'))
Focus-Target $h '${titleHint}'
# WhatsApp Web search (Windows): Ctrl+Alt+Shift+F
[System.Windows.Forms.SendKeys]::SendWait('^%+{F}')
Start-Sleep -Milliseconds 700
Set-Clipboard -Value $contact
[System.Windows.Forms.SendKeys]::SendWait('^a')
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 1100
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 1100
Set-Clipboard -Value $message
[System.Windows.Forms.SendKeys]::SendWait('^v')
${sendStep}
$fg2 = [RippleWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][RippleWin]::GetWindowText($fg2, $sb, 512)
$focused = ($fg2 -eq $h)
@{ ok = $focused; foregroundTitle = $sb.ToString() } | ConvertTo-Json -Compress
`.trim();

  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-STA", "-Command", script],
      { windowsHide: true, maxBuffer: 256 * 1024 },
    );

    if (stderr?.trim()) {
      console.warn("[ripple-desktop] WhatsApp keys stderr:", stderr.slice(0, 300));
    }

    const line = stdout.trim().split(/\r?\n/).pop() ?? "{}";
    const parsed = JSON.parse(line) as WhatsAppKeysResult;

    if (!parsed.ok) {
      throw new Error(
        `Chrome did not keep focus (foreground="${(parsed.foregroundTitle ?? "").slice(0, 40)}") — keyboard automation aborted`,
      );
    }

    console.warn(
      `[ripple-desktop] KEYBOARD FALLBACK only — not verified in WhatsApp DOM. Prefer CDP (--remote-debugging-port=9222).`,
    );
    return parsed;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ripple-desktop] WhatsApp keys failed:", msg);
    throw new Error(
      `Could not drive WhatsApp in Chrome (${msg}). Keep the WhatsApp tab visible and try again.`,
    );
  }
}
