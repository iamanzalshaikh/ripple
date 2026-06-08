import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FocusContext {
  hwnd: number;
  processName: string;
  windowTitle: string;
  activeTabUrl?: string;
  capturedAt: number;
  isGmail: boolean;
  isWhatsApp: boolean;
  isSlack: boolean;
  isNotion: boolean;
  isYouTube: boolean;
  isLinkedIn: boolean;
  isInstagram: boolean;
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
$windowPid = [uint32]0
[void][RippleFocus]::GetWindowThreadProcessId($hwnd, [ref]$windowPid)
$proc = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
$sb = New-Object System.Text.StringBuilder 512
[void][RippleFocus]::GetWindowText($hwnd, $sb, 512)
$title = -join ($sb.ToString().ToCharArray() | ForEach-Object {
  if ([int][char]$_ -lt 32 -or [int][char]$_ -eq 127) { ' ' } else { $_ }
}).Trim()
$name = if ($proc) { $proc.ProcessName } else { "" }
@{
  hwnd = [int64]$hwnd
  processName = $name
  windowTitle = $title
} | ConvertTo-Json -Compress
`.trim();

function parseFocusCaptureJson(stdout: string): {
  hwnd: number;
  processName: string;
  windowTitle: string;
} {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as {
      hwnd: number;
      processName: string;
      windowTitle: string;
    };
  } catch {
    const sanitized = trimmed.replace(/[\u0001-\u001F\u007F]/g, " ").replace(/\u0000/g, " ");
    return JSON.parse(sanitized) as {
      hwnd: number;
      processName: string;
      windowTitle: string;
    };
  }
}

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

/** Chrome/Edge tab title looks like Notion (avoids false positives on random pages). */
export function isNotionWindowTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /\bnotion\b/.test(t) ||
    t.includes("notion.so") ||
    t.includes("notion.new")
  );
}

function detectNotion(title: string, processName: string): boolean {
  const p = processName.toLowerCase();
  if (p.includes("notion")) return true;
  return isNotionWindowTitle(title);
}

export function isNotionFocused(): boolean {
  if (!saved?.isNotion) return false;
  return isNotionWindowTitle(saved.windowTitle);
}

export function isYouTubeWindowTitle(title: string): boolean {
  const t = title.toLowerCase();
  return /\byoutube\b/.test(t) || t.includes("youtube.com");
}

function detectYouTube(title: string, processName: string): boolean {
  const p = processName.toLowerCase();
  if (p.includes("youtube")) return true;
  return isYouTubeWindowTitle(title);
}

export function isYouTubeFocused(): boolean {
  if (!saved?.isYouTube) return false;
  return isYouTubeWindowTitle(saved.windowTitle);
}

export function isLinkedInWindowTitle(title: string): boolean {
  const t = title.toLowerCase();
  return /\blinkedin\b/.test(t) || t.includes("linkedin.com");
}

export function isLinkedInFocused(): boolean {
  if (!saved?.isLinkedIn) return false;
  return isLinkedInWindowTitle(saved.windowTitle);
}

/** True when the captured window title looks like LinkedIn (even if isLinkedIn flag missed). */
export function isLinkedInTabActive(): boolean {
  if (isLinkedInFocused()) return true;
  const ctx = saved;
  if (!ctx) return false;
  if (ctx.activeTabUrl && /linkedin\.com/i.test(ctx.activeTabUrl)) return true;
  return isLinkedInWindowTitle(ctx.windowTitle);
}

export function isInstagramWindowTitle(title: string): boolean {
  const t = title.toLowerCase();
  return /\binstagram\b/.test(t) || t.includes("instagram.com");
}

function detectInstagram(title: string, processName: string, url?: string): boolean {
  const p = processName.toLowerCase();
  if (p.includes("instagram")) return true;
  if (url && /instagram\.com/i.test(url)) return true;
  return isInstagramWindowTitle(title);
}

function detectLinkedIn(title: string, processName: string, url?: string): boolean {
  const p = processName.toLowerCase();
  if (p.includes("linkedin")) return true;
  if (url && /linkedin\.com/i.test(url)) return true;
  return isLinkedInWindowTitle(title);
}

function detectFromUrl(
  ctx: FocusContext,
  url: string,
  title: string,
): FocusContext {
  const windowTitle = title.trim() || ctx.windowTitle;
  return {
    ...ctx,
    windowTitle,
    activeTabUrl: url,
    isInstagram: detectInstagram(windowTitle, ctx.processName, url),
    isLinkedIn: detectLinkedIn(windowTitle, ctx.processName, url),
    isGmail: detectGmail(windowTitle, ctx.processName) || /mail\.google\.com/i.test(url),
    isWhatsApp: detectWhatsApp(windowTitle, ctx.processName) || /web\.whatsapp\.com/i.test(url),
    isYouTube: detectYouTube(windowTitle, ctx.processName) || /youtube\.com/i.test(url),
    isNotion: detectNotion(windowTitle, ctx.processName) || /notion\.(so|site)/i.test(url),
  };
}

async function enrichContextFromExtension(ctx: FocusContext): Promise<FocusContext> {
  if (!ctx.isBrowser) return ctx;
  try {
    const { queryActiveTabFromExtension } = await import(
      "../bridge/nativeMessagingBridge.js"
    );
    const tab = await queryActiveTabFromExtension();
    if (!tab?.url) return ctx;
    return detectFromUrl(ctx, tab.url, tab.title);
  } catch {
    return ctx;
  }
}

export function isInstagramFocused(): boolean {
  if (!saved?.isInstagram) return false;
  return isInstagramWindowTitle(saved.windowTitle);
}

/** True when the captured window title looks like Instagram (even if isInstagram flag missed). */
export function isInstagramTabActive(): boolean {
  if (isInstagramFocused()) return true;
  const ctx = saved;
  if (!ctx) return false;
  if (ctx.activeTabUrl && /instagram\.com/i.test(ctx.activeTabUrl)) return true;
  return isInstagramWindowTitle(ctx.windowTitle);
}

export function getFocusContext(): FocusContext | null {
  return saved;
}

export function setFocusContext(ctx: FocusContext): void {
  saved = ctx;
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
          : saved.isNotion
            ? "notion"
            : saved.isYouTube
              ? "youtube"
              : saved.isLinkedIn
                ? "linkedin"
                : saved.isInstagram
                  ? "instagram"
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
      isNotion: false,
      isYouTube: false,
      isLinkedIn: false,
      isInstagram: false,
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
    const raw = parseFocusCaptureJson(stdout);
    const ctx: FocusContext = {
      hwnd: Number(raw.hwnd) || 0,
      processName: raw.processName ?? "",
      windowTitle: raw.windowTitle ?? "",
      capturedAt: Date.now(),
      isGmail: detectGmail(raw.windowTitle ?? "", raw.processName ?? ""),
      isWhatsApp: detectWhatsApp(raw.windowTitle ?? "", raw.processName ?? ""),
      isSlack: detectSlack(raw.windowTitle ?? "", raw.processName ?? ""),
      isNotion: detectNotion(raw.windowTitle ?? "", raw.processName ?? ""),
      isYouTube: detectYouTube(raw.windowTitle ?? "", raw.processName ?? ""),
      isLinkedIn: detectLinkedIn(raw.windowTitle ?? "", raw.processName ?? ""),
      isInstagram: detectInstagram(raw.windowTitle ?? "", raw.processName ?? ""),
      isBrowser: detectBrowser(raw.processName ?? ""),
    };
    const enriched = await enrichContextFromExtension(ctx);
    saved = enriched;
    console.info(
      `[ripple-desktop] focus captured: ${enriched.processName} | "${enriched.windowTitle.slice(0, 60)}" | gmail=${enriched.isGmail} whatsapp=${enriched.isWhatsApp} notion=${enriched.isNotion} youtube=${enriched.isYouTube} linkedin=${enriched.isLinkedIn} instagram=${enriched.isInstagram}${enriched.activeTabUrl ? ` url=${enriched.activeTabUrl.slice(0, 50)}` : ""}`,
    );
    return enriched;
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] focus capture failed:",
      e instanceof Error ? e.message : e,
    );
    saved = null;
    return null;
  }
}

/** Re-read active tab URL from extension before command routing. */
export async function refreshFocusFromExtension(): Promise<FocusContext | null> {
  const ctx = saved ?? (await captureFocusContext());
  if (!ctx) return null;
  const enriched = await enrichContextFromExtension(ctx);
  saved = enriched;
  return enriched;
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
