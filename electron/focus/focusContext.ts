import { getForegroundWindow, focusWindowByHwnd, getWindowUnderCursorNative } from "../native/win32Bridge.js";
import { getMemory, setMemory } from "../storage/sessionMemory.js";
import { rememberPdfFromFocus } from "../automation/desktop/pdfFocusMemory.js";
import { rememberMediaFromFocus } from "../automation/desktop/mediaFocusMemory.js";
import { rememberFolderFromFocus } from "../automation/desktop/folderFocusMemory.js";
import type { ForegroundWindow } from "../native/types.js";
import {
  getSidecarCapabilities,
  isNativeClientAuthenticated,
} from "../native/nativeClient.js";
import {
  isSaveDialogContext,
  isSaveDialogModalLocked,
  isSaveDialogTitle,
} from "./saveDialogMode.js";

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

export function isClearlyDesktopForeground(ctx: FocusContext): boolean {
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
  return isRippleApplicationWindow(processName, windowTitle);
}

/** True when HWND belongs to Ripple itself (never a typing target). */
export function isRippleApplicationWindow(
  processName: string,
  windowTitle: string,
): boolean {
  const p = (processName ?? "").toLowerCase();
  const t = (windowTitle ?? "").toLowerCase().trim();

  if (p === "ripple-desktop" || p === "ripple.exe" || /^ripple[\w.-]*$/.test(p)) {
    return true;
  }

  if (p === "electron" || /\bripple\b/.test(p)) {
    if (!t || t === "ripple") return true;
    if (/^(?:ripple|voice|assistant|overlay)(?:\s|$)/i.test(t)) return true;
    if (/\bripple\s+(voice|assistant|desktop|overlay)\b/i.test(t)) return true;
    return false;
  }

  // Editor titles like "file.md - projectRipple" are not the Ripple app window.
  if (/\bproject\s*ripple\b/i.test(t)) return false;
  if (/\.[a-z0-9]{1,6}\s*[-–—]\s/.test(t)) return false;

  if (/^(?:ripple|voice|assistant|overlay)(?:\s|$)/i.test(t)) return true;
  if (/\bripple\s+(voice|assistant|desktop|overlay)\b/i.test(t)) return true;

  return false;
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
let lastNonRippleFocus: FocusContext | null = null;
let voiceCommandTarget: FocusContext | null = null;
let focusCaptureLocked = false;
let voiceSessionFrozen = false;
let commandFocusGraceUntil = 0;

const COMMAND_FOCUS_GRACE_MS = 8000;

/** Explorer desktop shell — never a valid keyboard/mouse typing target. */
export function isDesktopShellForeground(
  ctx: Pick<FocusContext, "processName" | "windowTitle">,
): boolean {
  const proc = (ctx.processName ?? "").toLowerCase();
  if (proc !== "explorer") return false;
  const title = (ctx.windowTitle ?? "").trim().toLowerCase();
  return !title || title === "program manager";
}

/** Shell HWNDs with no title are unreliable typing targets (steal focus from real apps). */
export function isWeakFocusContext(
  ctx: Pick<FocusContext, "hwnd" | "processName" | "windowTitle">,
): boolean {
  if (!ctx.hwnd) return true;
  if (isRippleOwnWindow(ctx.processName, ctx.windowTitle)) return true;
  if (isDesktopShellForeground(ctx)) return true;
  const title = (ctx.windowTitle ?? "").trim();
  const proc = (ctx.processName ?? "").toLowerCase();
  if (
    !title &&
    (proc === "explorer" ||
      proc === "shellexperiencehost" ||
      proc === "searchhost" ||
      proc === "applicationframehost")
  ) {
    return true;
  }
  return false;
}

export function setFocusCaptureLocked(locked: boolean): void {
  focusCaptureLocked = locked;
}

export function setVoiceSessionFrozen(frozen: boolean): void {
  voiceSessionFrozen = frozen;
}

/** Keep voice/typing target stable briefly after command execution. */
export function extendCommandFocusGrace(ms = COMMAND_FOCUS_GRACE_MS): void {
  commandFocusGraceUntil = Math.max(commandFocusGraceUntil, Date.now() + ms);
}

export function isCommandFocusGraceActive(): boolean {
  return Date.now() < commandFocusGraceUntil;
}

function bestStableFocus(): FocusContext | null {
  for (const ctx of [voiceCommandTarget, lastNonRippleFocus, saved]) {
    if (ctx?.hwnd && !isWeakFocusContext(ctx)) return ctx;
  }
  return voiceCommandTarget ?? lastNonRippleFocus ?? saved;
}

function rememberNonRippleFocus(ctx: FocusContext): void {
  if (
    !isRippleOwnWindow(ctx.processName, ctx.windowTitle) &&
    !isWeakFocusContext(ctx)
  ) {
    lastNonRippleFocus = ctx;
  }
}

function buildFocusContextFromRaw(raw: ForegroundWindow): FocusContext {
  return {
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
}

/** Snapshot the app the user was in when voice hotkey fired (before overlay). */
export async function snapshotPreVoiceTarget(): Promise<FocusContext | null> {
  if (process.platform !== "win32") return null;
  try {
    const raw = await getForegroundWindow();
    if (!raw?.hwnd) return lastNonRippleFocus;
    if (isRippleOwnWindow(raw.processName ?? "", raw.windowTitle ?? "")) {
      return lastNonRippleFocus ?? saved;
    }
    const ctx = buildFocusContextFromRaw(raw);
    if (!isWeakFocusContext(ctx)) {
      voiceCommandTarget = ctx;
      lastNonRippleFocus = ctx;
      saved = ctx;
      console.info(
        `[ripple-desktop] voice target: ${ctx.processName} | "${ctx.windowTitle.slice(0, 60)}"`,
      );
      return ctx;
    }

    const underMouse = await voiceTargetFromMouseFallback();
    if (underMouse) {
      voiceCommandTarget = underMouse;
      lastNonRippleFocus = underMouse;
      saved = underMouse;
      console.info(
        `[ripple-desktop] voice target (mouse fallback): ${underMouse.processName} | "${underMouse.windowTitle.slice(0, 60)}"`,
      );
      return underMouse;
    }

    const fallback = bestStableFocus();
    if (fallback) {
      voiceCommandTarget = fallback;
      console.info(
        `[ripple-desktop] voice target (weak fg skip): ${fallback.processName} | "${fallback.windowTitle.slice(0, 60)}"`,
      );
      return fallback;
    }

    console.info(
      `[ripple-desktop] voice target weak/unresolved: ${ctx.processName} | "${ctx.windowTitle.slice(0, 60)}"`,
    );
    return null;
  } catch {
    return lastNonRippleFocus;
  }
}

async function voiceTargetFromMouseFallback(): Promise<FocusContext | null> {
  const under = await getWindowUnderCursorNative();
  if (!under?.hwnd) return null;
  if (isRippleOwnWindow(under.processName ?? "", under.windowTitle ?? "")) {
    return null;
  }
  const ctx = buildFocusContextFromRaw(under);
  if (isWeakFocusContext(ctx)) return null;
  return ctx;
}

export function clearVoiceCommandTarget(): void {
  voiceCommandTarget = null;
}

export function resolveTypingFocusTarget(): FocusContext | null {
  const candidates = [voiceCommandTarget, lastNonRippleFocus, saved];
  for (const ctx of candidates) {
    if (
      ctx?.hwnd &&
      !isRippleOwnWindow(ctx.processName, ctx.windowTitle) &&
      !isWeakFocusContext(ctx)
    ) {
      return ctx;
    }
  }
  return null;
}

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

export function isDesktopAppForeground(): boolean {
  const ctx = resolveTypingFocusTarget() ?? voiceCommandTarget ?? saved;
  if (!ctx?.hwnd) return false;
  return isClearlyDesktopForeground(ctx);
}

/** True when WhatsApp Web is the focused context. */
export function isWhatsAppTabActive(): boolean {
  const ctx = voiceCommandTarget ?? saved;
  if (ctx) {
    if (isClearlyDesktopForeground(ctx)) return false;
    if (ctx.isWhatsApp) return true;
    if (ctx.activeTabUrl && /web\.whatsapp\.com/i.test(ctx.activeTabUrl)) return true;
    if (detectWhatsApp(ctx.windowTitle, ctx.processName)) return true;
    return false;
  }
  if (voiceCommandTarget && isClearlyDesktopForeground(voiceCommandTarget)) {
    return false;
  }
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

/** Window titles from voice target + recent non-Ripple focus (stable across overlay steal). */
export function getStableFocusTitles(): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const ctx of [voiceCommandTarget, lastNonRippleFocus, saved]) {
    const title = ctx?.windowTitle?.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

export function setFocusContext(ctx: FocusContext): void {
  saved = ctx;
}

/** Pin typing/focus target to the modal Save As window (not parent editor HWND). */
export function adoptSaveDialogTarget(raw: ForegroundWindow): FocusContext {
  const ctx = buildFocusContextFromRaw(raw);
  voiceCommandTarget = ctx;
  saved = ctx;
  lastNonRippleFocus = ctx;
  extendCommandFocusGrace(12_000);
  console.info(
    `[ripple-desktop] save dialog lock → ${ctx.processName} | "${ctx.windowTitle.slice(0, 40)}"`,
  );
  return ctx;
}

export async function adoptForegroundAsTypingTarget(): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    const raw = await getForegroundWindow();
    if (!raw?.hwnd) return;
    if (isRippleOwnWindow(raw.processName ?? "", raw.windowTitle ?? "")) return;
    const ctx = buildFocusContextFromRaw(raw);
    if (isSaveDialogContext(ctx)) {
      adoptSaveDialogTarget(raw);
      return;
    }
    if (isWeakFocusContext(ctx)) return;
    voiceCommandTarget = ctx;
    saved = ctx;
    lastNonRippleFocus = ctx;
    extendCommandFocusGrace(12_000);
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] adopt foreground focus failed:",
      e instanceof Error ? e.message : e,
    );
  }
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

export async function captureFocusFromForeground(
  raw: ForegroundWindow,
): Promise<FocusContext | null> {
  if (process.platform !== "win32") return null;

  try {
    const ctx = buildFocusContextFromRaw(raw);

    if (isSaveDialogContext(ctx)) {
      const adopted = adoptSaveDialogTarget(raw);
      rememberWebSurface(adopted);
      return adopted;
    }

    if (focusCaptureLocked || voiceSessionFrozen || isCommandFocusGraceActive()) {
      if (isSaveDialogModalLocked()) {
        const saveTarget = voiceCommandTarget ?? saved;
        if (saveTarget) return saveTarget;
      }
      if (
        isCommandFocusGraceActive() &&
        voiceCommandTarget &&
        !isWeakFocusContext(voiceCommandTarget)
      ) {
        return voiceCommandTarget;
      }
      const keep = bestStableFocus();
      if (keep) {
        return keep;
      }
    }
    if (isRippleOwnWindow(raw.processName ?? "", raw.windowTitle ?? "")) {
      // Requirement: do not overwrite context memory when the Ripple overlay
      // takes foreground — preserve the previous external foreground context.
      const preserved = saved ?? bestStableFocus();
      if (preserved) {
        const surface = getStickyWebSurface();
        console.info(
          `[ripple-desktop] focus skip Ripple window — keeping ${preserved.processName}${surface ? ` (previousForeground surface=${surface})` : ""}`,
        );
        return preserved;
      }
    }
    if (isWeakFocusContext(ctx)) {
      const keep = bestStableFocus();
      if (keep) {
        console.info(
          `[ripple-desktop] focus skip weak window — keeping ${keep.processName}`,
        );
        return keep;
      }
      console.info(
        `[ripple-desktop] focus skip weak: ${ctx.processName} | "${ctx.windowTitle.slice(0, 40)}"`,
      );
      return null;
    }
    const enriched = await enrichContextFromExtension(ctx);
    const signature = `${enriched.hwnd}:${enriched.processName}:${enriched.windowTitle}`;
    const now = Date.now();
    if (
      saved &&
      signature !== lastFocusSignature &&
      now - lastFocusCaptureAt < FOCUS_CAPTURE_DEBOUNCE_MS
    ) {
      return saved;
    }
    if (isCommandFocusGraceActive() && !isSaveDialogModalLocked()) {
      if (voiceCommandTarget && !isWeakFocusContext(voiceCommandTarget)) {
        return voiceCommandTarget;
      }
      const keep = bestStableFocus();
      if (keep) {
        return keep;
      }
    }
    saved = enriched;
    lastFocusCaptureAt = now;
    lastFocusSignature = signature;
    rememberNonRippleFocus(enriched);
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
    return captureFocusFromForeground(raw);
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
  if (voiceSessionFrozen || focusCaptureLocked || voiceCommandTarget) {
    const base = voiceCommandTarget ?? saved;
    if (!base) return null;
    const enriched = await enrichContextFromExtension(base);
    saved = enriched;
    return enriched;
  }
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
const P8_FOCUS_SIDECAR_FALLBACK_MS = 10_000;
const P8_BURST_DURATION_MS = 12_000;
let p8FocusTimer: ReturnType<typeof setTimeout> | null = null;
let p8BurstUntil = 0;
const FOCUS_CAPTURE_DEBOUNCE_MS = 700;
let lastFocusCaptureAt = 0;
let lastFocusSignature = "";

function isExplorerOrShellProcess(processName: string): boolean {
  const p = processName.toLowerCase();
  return (
    p === "explorer" ||
    p.includes("photos") ||
    p.includes("applicationframehost") ||
    p.includes("dllhost")
  );
}

function sidecarForegroundEventsActive(): boolean {
  return (
    isNativeClientAuthenticated() &&
    getSidecarCapabilities()?.foregroundEvents === true
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
        const sidecarEvents = sidecarForegroundEventsActive();
        const delay = sidecarEvents
          ? P8_FOCUS_SIDECAR_FALLBACK_MS
          : Date.now() < p8BurstUntil
            ? P8_FOCUS_BURST_MS
            : intervalMs;
        scheduleP8FocusPoll(delay);
      }
    })();
  }, intervalMs);
}

/** Poll foreground — tracks pdf, image, video, folder views into activity_log (P8). */
export function startMediaFocusWatcher(intervalMs = P8_FOCUS_POLL_MS): void {
  if (p8FocusTimer || process.platform !== "win32") return;
  const sidecarEvents = sidecarForegroundEventsActive();
  const baseInterval = sidecarEvents ? P8_FOCUS_SIDECAR_FALLBACK_MS : intervalMs;
  scheduleP8FocusPoll(baseInterval);
  if (sidecarEvents) {
    console.info(
      `[ripple-desktop] P8 focus watcher → sidecar foreground events + ${P8_FOCUS_SIDECAR_FALLBACK_MS}ms fallback poll`,
    );
  } else {
    console.info(
      `[ripple-desktop] P8 focus watcher → ${intervalMs}ms default, ${P8_FOCUS_BURST_MS}ms burst when Explorer/Photos active`,
    );
  }
}

export async function restoreFocusContext(): Promise<boolean> {
  if (isSaveDialogModalLocked()) {
    if (process.platform !== "win32") return false;
    try {
      const raw = await getForegroundWindow();
      if (raw?.hwnd && isSaveDialogTitle(raw.windowTitle)) {
        await focusWindowByHwnd(Number(raw.hwnd), raw.windowTitle ?? "Save As");
        adoptSaveDialogTarget(raw);
        return true;
      }
    } catch {
      /* keep save dialog lock — do not restore parent editor */
    }
    return false;
  }

  const target =
    resolveTypingFocusTarget() ??
    (voiceCommandTarget && !isWeakFocusContext(voiceCommandTarget)
      ? voiceCommandTarget
      : null);
  if (!target?.hwnd || isDesktopShellForeground(target)) return false;

  if (process.platform !== "win32") {
    return false;
  }

  try {
    await focusWindowByHwnd(target.hwnd, target.windowTitle);
    await new Promise((r) => setTimeout(r, 350));
    saved = target;
    lastNonRippleFocus = target;
    console.info(
      `[ripple-desktop] focus restored → ${target.processName} | "${target.windowTitle.slice(0, 60)}"`,
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
