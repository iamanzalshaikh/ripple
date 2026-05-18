import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FocusContext {
  hwnd: number;
  processName: string;
  windowTitle: string;
  capturedAt: number;
  isGmail: boolean;
  isWhatsApp: boolean;
  isSlack: boolean;
  isBrowser: boolean;
}

let saved: FocusContext | null = null;

const WIN_CAPTURE_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class RippleFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$hwnd = [RippleFocus]::GetForegroundWindow()
$pid = 0
[void][RippleFocus]::GetWindowThreadProcessId($hwnd, [ref]$pid)
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
$sb = New-Object System.Text.StringBuilder 512
[void][RippleFocus]::GetWindowText($hwnd, $sb, 512)
$title = $sb.ToString()
$name = if ($proc) { $proc.ProcessName } else { "" }
@{
  hwnd = [int64]$hwnd
  processName = $name
  windowTitle = $title
} | ConvertTo-Json -Compress
`.trim();

const WIN_RESTORE_SCRIPT = (hwnd: number) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RippleFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
$hwnd = [IntPtr]${hwnd}
if ([RippleFocus]::IsIconic($hwnd)) { [void][RippleFocus]::ShowWindow($hwnd, 9) }
[void][RippleFocus]::BringWindowToTop($hwnd)
[void][RippleFocus]::SetForegroundWindow($hwnd)
`.trim();

function detectGmail(title: string, processName: string): boolean {
  const t = title.toLowerCase();
  const p = processName.toLowerCase();
  if (t.includes("gmail") || t.includes("mail.google")) return true;
  if (
    (p === "chrome" || p === "msedge" || p === "firefox" || p === "brave") &&
    (t.includes("compose") || t.includes("inbox") || t.includes("mail"))
  ) {
    return true;
  }
  return false;
}

function detectBrowser(processName: string): boolean {
  const p = processName.toLowerCase();
  return ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"].includes(p);
}

function detectWhatsApp(title: string, processName: string): boolean {
  const t = title.toLowerCase();
  const p = processName.toLowerCase();
  return p.includes("whatsapp") || t.includes("whatsapp");
}

function detectSlack(title: string, processName: string): boolean {
  const t = title.toLowerCase();
  const p = processName.toLowerCase();
  return p.includes("slack") || t.includes("slack");
}

export function getFocusContext(): FocusContext | null {
  return saved;
}

export function clearFocusContext(): void {
  saved = null;
}

export function focusContextToMetadata(): Record<string, unknown> {
  if (!saved) return {};
  return {
    focused_app: saved.processName,
    window_title: saved.windowTitle,
    action_source: saved.isGmail
      ? "gmail"
      : saved.isWhatsApp
        ? "whatsapp"
        : saved.isSlack
          ? "slack"
          : saved.isBrowser
            ? "browser"
            : "desktop",
    input_type: saved.isGmail ? "email_body" : "text",
    focus_hwnd: saved.hwnd,
  };
}

export async function captureFocusContext(): Promise<FocusContext | null> {
  if (process.platform !== "win32") {
    saved = {
      hwnd: 0,
      processName: "unknown",
      windowTitle: "",
      capturedAt: Date.now(),
      isGmail: false,
      isWhatsApp: false,
      isSlack: false,
      isBrowser: false,
    };
    return saved;
  }

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", WIN_CAPTURE_SCRIPT],
      { windowsHide: true, maxBuffer: 1024 * 64 },
    );
    const raw = JSON.parse(stdout.trim()) as {
      hwnd: number;
      processName: string;
      windowTitle: string;
    };
    const ctx: FocusContext = {
      hwnd: Number(raw.hwnd) || 0,
      processName: raw.processName ?? "",
      windowTitle: raw.windowTitle ?? "",
      capturedAt: Date.now(),
      isGmail: detectGmail(raw.windowTitle ?? "", raw.processName ?? ""),
      isWhatsApp: detectWhatsApp(raw.windowTitle ?? "", raw.processName ?? ""),
      isSlack: detectSlack(raw.windowTitle ?? "", raw.processName ?? ""),
      isBrowser: detectBrowser(raw.processName ?? ""),
    };
    saved = ctx;
    console.info(
      `[ripple-desktop] focus captured: ${ctx.processName} | "${ctx.windowTitle.slice(0, 60)}" | gmail=${ctx.isGmail} whatsapp=${ctx.isWhatsApp}`,
    );
    return ctx;
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] focus capture failed:",
      e instanceof Error ? e.message : e,
    );
    saved = null;
    return null;
  }
}

export async function restoreFocusContext(): Promise<boolean> {
  if (!saved?.hwnd) return false;

  if (process.platform !== "win32") {
    return false;
  }

  try {
    await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", WIN_RESTORE_SCRIPT(saved.hwnd)],
      { windowsHide: true },
    );
    await new Promise((r) => setTimeout(r, 350));
    console.info(
      `[ripple-desktop] focus restored → ${saved.processName} | "${saved.windowTitle.slice(0, 60)}"`,
    );
    return true;
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] focus restore failed:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}
