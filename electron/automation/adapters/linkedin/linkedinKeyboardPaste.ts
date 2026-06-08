import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFocusContext } from "../../../focus/focusContext.js";
import { releaseDesktopFocus } from "../../releaseDesktopFocus.js";

const execFileAsync = promisify(execFile);

function toBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/**
 * Strong foreground + Ctrl+V into whatever field is focused in Chrome.
 * User must have LinkedIn post composer open with cursor in the text box.
 */
export async function pasteLinkedInViaKeyboard(text: string): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error("LinkedIn post text is empty");

  const ctx = getFocusContext();
  if (!ctx?.hwnd) {
    throw new Error("No LinkedIn window captured — focus LinkedIn feed, then use voice again");
  }

  releaseDesktopFocus();
  await new Promise((r) => setTimeout(r, 300));

  const titleHint = (ctx.windowTitle || "LinkedIn").slice(0, 80).replace(/'/g, "''");
  const bodyB64 = toBase64(body);

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
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
}
"@
$h = [IntPtr]${ctx.hwnd}
$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${bodyB64}'))
[void][RippleWin]::AllowSetForegroundWindow(-1)
$ws = New-Object -ComObject WScript.Shell
$null = $ws.AppActivate('${titleHint}')
if (-not $?) { $null = $ws.AppActivate('LinkedIn') }
if ([RippleWin]::IsIconic($h)) { [void][RippleWin]::ShowWindow($h, 9) }
[void][RippleWin]::BringWindowToTop($h)
[void][RippleWin]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 1100
Set-Clipboard -Value $body
[System.Windows.Forms.SendKeys]::SendWait('^a')
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 500
$fg = [RippleWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][RippleWin]::GetWindowText($fg, $sb, 512)
$title = $sb.ToString()
$onChrome = ($fg -eq $h) -or ($title -match 'LinkedIn')
@{ ok = $onChrome; foregroundTitle = $title } | ConvertTo-Json -Compress
`.trim();

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-STA", "-Command", script],
      { windowsHide: true, maxBuffer: 256 * 1024 },
    );
    const line = stdout.trim().split(/\r?\n/).pop() ?? "{}";
    const parsed = JSON.parse(line) as { ok?: boolean; foregroundTitle?: string };
    if (!parsed.ok) {
      throw new Error(
        `Chrome lost focus (foreground="${(parsed.foregroundTitle ?? "").slice(0, 50)}") — click inside the LinkedIn post box and retry`,
      );
    }
    return `Keyboard paste sent (${body.length} chars) — verify text appears in the post composer`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${msg}. First click "Start a post", then click inside "What do you want to talk about?", then run the voice command again.`,
    );
  }
}
