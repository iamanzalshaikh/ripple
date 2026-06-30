import { getForegroundWindow, focusWindowByHwnd } from "../native/win32Bridge.js";
import { getMemory, setMemory } from "../storage/sessionMemory.js";
import { rememberPdfFromFocus } from "../automation/desktop/pdfFocusMemory.js";
import { rememberMediaFromFocus } from "../automation/desktop/mediaFocusMemory.js";
import { rememberFolderFromFocus } from "../automation/desktop/folderFocusMemory.js";

const STICKY_WEB_MS = 15 * 60 * 1000;

export type StickyWebSurface =
  | "whatsapp"
  | "gmail"
  | "instagram"
  | "linkedin"
  | "youtube"
  | "notion"
  | "slack";

function surfaceFromContext(ctx: FocusContext): StickyWebSurface | null {
  if (ctx.isWhatsApp) return "whatsapp";
  if (ctx.isGmail) return "gmail";
  if (ctx.isInstagram) return "instagram";
  if (ctx.isLinkedIn) return "linkedin";
  if (ctx.isYouTube) return "youtube";
  if (ctx.isNotion) return "notion";
  if (ctx.isSlack) return "slack";
  return null;
}

function rememberWebSurface(ctx: FocusContext): void {
  const surface = surfaceFromContext(ctx);
  if (!surface) {
    // Left Chrome/web — don't let stale WhatsApp sticky steal desktop commands.
    if (!ctx.isBrowser) {
      setMemory("last_web_surface_at", "0");
    }
    return;
  }
  setMemory("last_web_surface", surface);
  setMemory("last_web_surface_at", String(Date.now()));
}

function isClearlyDesktopForeground(ctx: FocusContext): boolean {
  if (ctx.isBrowser) return false;
  const p = ctx.processName.toLowerCase();
  return (
    p === "explorer" ||
    p.includes("calculator") ||
    p.includes("applicationframehost") ||
    p.includes("systemsettings") ||
    p.includes("searchhost") ||
    p.includes("shellexperiencehost") ||
    (!ctx.isWhatsApp &&
      !ctx.isGmail &&
      !ctx.isYouTube &&
      !ctx.isLinkedIn &&
      !ctx.isInstagram &&
      !ctx.isNotion)
  );
}

export function getStickyWebSurface(): StickyWebSurface | null {
  const at = Number(getMemory("last_web_surface_at") ?? "0");
  if (!at || Date.now() - at > STICKY_WEB_MS) return null;
  const surface = getMemory("last_web_surface");
  return surface ? (surface as StickyWebSurface) : null;
}

function isRippleOwnWindow(processName: string, windowTitle: string): boolean {
  const p = processName.toLowerCase();
  const t = windowTitle.toLowerCase();
  return (
    p.includes("ripple") ||
    t.includes("ripple") ||
    (p.includes("electron") && /ripple|voice|assistant/i.test(t))
  );
}

/** Keep web-app flags from captured window title when extension reports a different active tab. */
function preserveCapturedWebFlags(prev: FocusContext, next: FocusContext): FocusContext {
  const merged = { ...next };
  const title = prev.windowTitle;
  const proc = prev.processName;
  if (prev.isWhatsApp || detectWhatsApp(title, proc)) merged.isWhatsApp = true;
  if (prev.isGmail || detectGmail(title, proc)) merged.isGmail = true;
  if (prev.isInstagram || detectInstagram(title, proc, prev.activeTabUrl)) {
    merged.isInstagram = true;
  }
  if (prev.isLinkedIn || detectLinkedIn(title, proc, prev.activeTabUrl)) {
    merged.isLinkedIn = true;
  }
  if (prev.isYouTube || detectYouTube(title, proc)) merged.isYouTube = true;
  if (prev.isNotion || detectNotion(title, proc)) merged.isNotion = true;
  if (prev.isSlack || detectSlack(title, proc)) merged.isSlack = true;
  return merged;
}

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
    return preserveCapturedWebFlags(ctx, detectFromUrl(ctx, tab.url, tab.title));
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

/** True when WhatsApp Web is the focused context. */
export function isWhatsAppTabActive(): boolean {
  const ctx = saved;
  if (ctx) {
    if (isClearlyDesktopForeground(ctx)) return false;
    if (ctx.isWhatsApp) return true;
    if (ctx.activeTabUrl && /web\.whatsapp\.com/i.test(ctx.activeTabUrl)) return true;
    if (detectWhatsApp(ctx.windowTitle, ctx.processName)) return true;
    return false;
  }
  // Overlay stole focus — short sticky fallback only when we have no hwnd context.
  return getStickyWebSurface() === "whatsapp";
}

/** Gmail tab in browser (inbox or thread) — not compose-only. */
export function isGmailTabActive(): boolean {
  const ctx = saved;
  if (ctx) {
    if (isClearlyDesktopForeground(ctx)) return false;
    if (ctx.isGmail) return true;
    if (ctx.activeTabUrl && /mail\.google\.com/i.test(ctx.activeTabUrl)) return true;
    if (detectGmail(ctx.windowTitle, ctx.processName)) return true;
    return false;
  }
  return getStickyWebSurface() === "gmail";
}

/** Gmail compose window (not inbox) — in-place edit / Urdu voice. */
export function isGmailComposeFocused(): boolean {
  const ctx = saved;
  if (!ctx?.isGmail) return false;
  const url = (ctx.activeTabUrl ?? "").toLowerCase();
  const title = ctx.windowTitle.toLowerCase();
  return (
    url.includes("tf=cm") ||
    title.includes("compose") ||
    title.includes("draft")
  );
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
    const raw = await getForegroundWindow();
    if (!raw) {
      saved = null;
      return null;
    }
    if (isRippleOwnWindow(raw.processName ?? "", raw.windowTitle ?? "")) {
      if (saved) {
        console.info("[ripple-desktop] focus skip Ripple window — keeping prior context");
        return saved;
      }
    }
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
    rememberWebSurface(enriched);
    rememberPdfFromFocus(enriched);
    rememberMediaFromFocus(enriched);
    rememberFolderFromFocus(enriched);
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

/** Re-read focus + extension tab URL before command routing. */
export async function refreshFocusFromExtension(): Promise<FocusContext | null> {
  await captureFocusContext();
  const ctx = saved;
  if (!ctx) return null;
  const enriched = await enrichContextFromExtension(ctx);
  saved = enriched;
  rememberWebSurface(enriched);
  rememberPdfFromFocus(enriched);
  rememberMediaFromFocus(enriched);
  rememberFolderFromFocus(enriched);
  return enriched;
}

const P8_FOCUS_POLL_MS = 2000;
const P8_FOCUS_BURST_MS = 500;
const P8_BURST_DURATION_MS = 12_000;
let p8FocusTimer: ReturnType<typeof setTimeout> | null = null;
let p8BurstUntil = 0;

function isExplorerOrShellProcess(processName: string): boolean {
  const p = processName.toLowerCase();
  return (
    p === "explorer" ||
    p.includes("photos") ||
    p.includes("applicationframehost") ||
    p.includes("dllhost")
  );
}

function scheduleP8FocusPoll(intervalMs: number): void {
  if (p8FocusTimer) clearTimeout(p8FocusTimer);
  p8FocusTimer = setTimeout(() => {
    void (async () => {
      try {
        const ctx = await captureFocusContext();
        if (ctx && isExplorerOrShellProcess(ctx.processName)) {
          p8BurstUntil = Date.now() + P8_BURST_DURATION_MS;
        }
      } catch {
        /* ignore poll errors */
      } finally {
        const delay =
          Date.now() < p8BurstUntil ? P8_FOCUS_BURST_MS : intervalMs;
        scheduleP8FocusPoll(delay);
      }
    })();
  }, intervalMs);
}

/** Poll foreground — tracks pdf, image, video, folder views into activity_log (P8). */
export function startMediaFocusWatcher(intervalMs = P8_FOCUS_POLL_MS): void {
  if (p8FocusTimer || process.platform !== "win32") return;
  scheduleP8FocusPoll(intervalMs);
  console.info(
    `[ripple-desktop] P8 focus watcher → ${intervalMs}ms default, ${P8_FOCUS_BURST_MS}ms burst when Explorer/Photos active`,
  );
}

export async function restoreFocusContext(): Promise<boolean> {
  if (!saved?.hwnd) return false;

  if (process.platform !== "win32") {
    return false;
  }

  try {
    await focusWindowByHwnd(saved.hwnd, saved.windowTitle);
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
