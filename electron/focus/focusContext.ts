import { getForegroundWindow, focusWindowByHwnd, getWindowUnderCursorNative, allowSetForegroundNative, lockSetForegroundNative, getWindowClassNameNative } from "../native/win32Bridge.js";
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
import { setMainActivationSuppressed } from "../windows/mainWindow.js";

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

/** Shell hwnds seen during the current dictation (same-hwnd? across steals). */
const shellStealHwndsThisDictation: number[] = [];

/**
 * Short-lived LockSetForegroundWindow held only around an individual
 * SetForegroundWindow call (restore / claim-then-hide). The session-scoped
 * dictation lock (session_fg_lock) is gone: it slowed shell recovery ~5x
 * and never blocked the steals it was added for.
 */
export async function nestedForegroundLock(lock: boolean): Promise<void> {
  await lockSetForegroundNative(lock);
}

function classifyShellClass(className: string): string {
  const c = (className ?? "").trim();
  if (!c) return "unknown";
  if (c === "Progman" || c === "WorkerW") return "desktop";
  if (c === "Shell_TrayWnd") return "taskbar";
  if (c === "Shell_SecondaryTrayWnd") return "secondary_tray";
  if (c === "NotifyIconOverflowWindow") return "tray_overflow";
  if (/IME|Input|TextInput|Candidate|MSCTFIME|Windows\.UI\.Input/i.test(c)) {
    return "ime_input";
  }
  if (c === "Windows.UI.Core.CoreWindow") return "uwp_core";
  if (c === "#32769") return "desktop_root";
  return "other";
}

/** Log explorer hwnd + GetClassName + same-hwnd-within-dictation. */
export async function logShellForegroundIdentity(
  fg: Pick<ForegroundWindow, "hwnd" | "processName" | "windowTitle" | "className">,
  reason: string,
): Promise<void> {
  const hwnd = Number(fg.hwnd) || 0;
  let className = (fg.className ?? "").trim();
  if (!className && hwnd) {
    className = await getWindowClassNameNative(hwnd);
  }
  const kind = classifyShellClass(className);
  const prev = shellStealHwndsThisDictation[shellStealHwndsThisDictation.length - 1];
  shellStealHwndsThisDictation.push(hwnd);
  const sameTag =
    prev === undefined
      ? "same_hwnd=first"
      : prev === hwnd
        ? "same_hwnd=1"
        : `same_hwnd=0 prior=${prev}`;
  console.warn(
    `[ripple-focus-drift] shell_fg_identity reason=${reason}` +
      ` hwnd=${hwnd} class="${className || "?"}" kind=${kind} ${sameTag}` +
      ` title="${(fg.windowTitle ?? "").slice(0, 40)}"`,
  );
  logRippleWindowsBeforeShell(reason);
}

/** Explorer desktop shell — never a valid keyboard/mouse typing target. */
export function isDesktopShellForeground(
  ctx: Pick<FocusContext, "processName" | "windowTitle">,
): boolean {
  const proc = (ctx.processName ?? "").toLowerCase();
  if (proc !== "explorer") return false;
  const title = (ctx.windowTitle ?? "").trim().toLowerCase();
  return !title || title === "program manager";
}

/** Windows IME / touch-keyboard chrome — steals FG briefly during dictation. */
function isTransientInputShell(
  ctx: Pick<FocusContext, "processName" | "windowTitle">,
): boolean {
  const proc = (ctx.processName ?? "").toLowerCase();
  const title = (ctx.windowTitle ?? "").trim().toLowerCase();
  if (
    proc === "textinputhost" ||
    proc === "tabtip" ||
    proc === "tabtip.exe" ||
    proc.includes("textinputhost")
  ) {
    return true;
  }
  if (proc === "explorer" || proc === "shellexperiencehost") {
    return /input flyout|emoji|touch keyboard|handwriting|text input/.test(
      title,
    );
  }
  return false;
}

/** Shell HWNDs with no title are unreliable typing targets (steal focus from real apps). */
export function isWeakFocusContext(
  ctx: Pick<FocusContext, "hwnd" | "processName" | "windowTitle">,
): boolean {
  if (!ctx.hwnd) return true;
  if (isRippleOwnWindow(ctx.processName, ctx.windowTitle)) return true;
  if (isDesktopShellForeground(ctx)) return true;
  if (isTransientInputShell(ctx)) return true;
  const title = (ctx.windowTitle ?? "").trim();
  const proc = (ctx.processName ?? "").toLowerCase();
  // Windows Search / shell hosts are never dictation insert targets — even
  // with a title like "Search". Treating them as strong caused cold-start
  // pins that lost focus into the flyout (live 2026-08-10).
  if (
    proc === "searchhost" ||
    proc === "shellexperiencehost" ||
    proc === "startmenuexperiencehost" ||
    proc === "searchapp"
  ) {
    return true;
  }
  if (
    !title &&
    (proc === "explorer" ||
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

function describePinCandidate(
  ctx:
    | Pick<FocusContext, "hwnd" | "processName" | "windowTitle">
    | ForegroundWindow
    | null
    | undefined,
): string {
  if (!ctx?.hwnd) return "none";
  return `${ctx.processName ?? "?"}:${ctx.hwnd} "${(ctx.windowTitle ?? "").slice(0, 30)}"`;
}

/** Snapshot the app the user was in when voice hotkey fired (before overlay). */
export async function snapshotPreVoiceTarget(): Promise<FocusContext | null> {
  if (process.platform !== "win32") return null;
  // The pin must come from live OS state at this exact moment — never from a
  // pre-hotkey cached pin. A stale voiceCommandTarget (previous session /
  // focus-watcher cache) pinned WhatsApp while the user dictated into another
  // window, and insert then yanked the screen back (live on/off bug).
  const cachedPin = voiceCommandTarget;
  voiceCommandTarget = null;
  shellStealHwndsThisDictation.length = 0;
  try {
    // Hotkey path: never let titled Ripple main steal FG during pin+overlay.
    yieldRippleForeground();
    // NOTE: allowSetForegroundNative() is deliberately NOT called here.
    // The sidecar's grant_foreground_permission() ends in synthetic_alt_tap(),
    // i.e. a real Alt keydown/up injected into whatever window is focused.
    // Alt is the menu-activation key in Win32/Electron apps: in Notepad and
    // Cursor that armed the menu bar and pulled keyboard focus out of the text
    // area on hotkey press ("I focus Notepad, press the hotkey, focus is
    // lost"). Chrome ignores a bare Alt, which is why only desktop apps broke.
    // Foreground rights are only needed when we actually have to CHANGE the
    // foreground, so the call now lives in the fg-mismatch branch below.
    // Live GetForegroundWindow at hotkey-press; retry once on an RPC hiccup
    // so a transient null doesn't dump us onto cached memory.
    let raw = await getForegroundWindow();
    if (!raw?.hwnd) {
      raw = await getForegroundWindow();
    }
    let pinned: FocusContext | null = null;
    let pinSource = "live_fg";
    if (!raw?.hwnd) {
      pinSource = "empty_fg";
      pinned = pinVoiceTarget(
        await recoverDictationFocusTarget("empty_fg"),
        "empty_fg",
      );
    } else if (isRippleOwnWindow(raw.processName ?? "", raw.windowTitle ?? "")) {
      // Ripple main/overlay in front at hotkey — never pin Ripple; recover a
      // real typing surface (mouse / last-good / live non-Ripple FG).
      pinSource = "ripple_fg";
      pinned = pinVoiceTarget(
        await recoverDictationFocusTarget("ripple_fg"),
        "ripple_fg",
      );
    } else {
      const ctx = buildFocusContextFromRaw(raw);
      if (!isWeakFocusContext(ctx)) {
        pinned = pinVoiceTarget(ctx, "foreground");
      } else {
        // Shell / Search / IME flash — recover without clearing a warm last-good.
        pinSource = "weak_fg";
        pinned = pinVoiceTarget(
          await recoverDictationFocusTarget("weak_fg"),
          "weak_fg",
        );
      }
    }

    const staleCacheDropped =
      cachedPin?.hwnd && Number(cachedPin.hwnd) !== Number(pinned?.hwnd ?? 0);
    console.info(
      `[ripple-focus-drift] hotkey_pin pin_source=${pinSource}` +
        ` fg=${describePinCandidate(raw)}` +
        ` cached=${describePinCandidate(cachedPin)}` +
        ` pinned=${describePinCandidate(pinned)}` +
        `${staleCacheDropped ? " stale_cache_dropped=1" : ""}`,
    );

    // Re-assert the pin under LockSetForegroundWindow so the overlay
    // showInactive transition does not leave a FG vacuum for explorer —
    // but ONLY when the pin is not already the live foreground. In the
    // normal press (target focused, hotkey pressed) touching the FG window
    // at all (AppActivate / BringWindowToTop / SetForegroundWindow) risks a
    // visible z-order blip; press must cause zero foreground change.
    if (pinned?.hwnd && Number(pinned.hwnd) === Number(raw?.hwnd ?? 0)) {
      console.info(
        `[ripple-focus-drift] press_reassert=skip_fg_match t=${Date.now()} hwnd=${pinned.hwnd}`,
      );
    } else if (pinned?.hwnd) {
      console.info(
        `[ripple-focus-drift] press_reassert=focus t=${Date.now()}` +
          ` hwnd=${pinned.hwnd} fg=${describePinCandidate(raw)}`,
      );
      try {
        await allowSetForegroundNative();
        await nestedForegroundLock(true);
        await focusWindowByHwnd(pinned.hwnd, pinned.windowTitle);
      } catch {
        /* best-effort — insert restore still recovers */
      } finally {
        try {
          await nestedForegroundLock(false);
        } catch {
          /* ignore */
        }
      }
    }
    return pinned;
  } catch {
    return pinVoiceTarget(
      lastNonRippleFocus &&
        !isRippleOwnWindow(
          lastNonRippleFocus.processName,
          lastNonRippleFocus.windowTitle,
        ) &&
        !isWeakFocusContext(lastNonRippleFocus)
        ? lastNonRippleFocus
        : null,
      "snapshot_error",
    );
  }
}

/**
 * Cold-start / Ripple-FG recovery for dictation insert target.
 * Never returns Ripple or weak shell windows. Prefer mouse → last-good → live FG.
 * Pins the recovered target so restoreFocusContext / insert ladder can use it.
 */
export async function recoverDictationFocusTarget(
  reason = "recover",
): Promise<FocusContext | null> {
  // Keep a stable hotkey pin — never silently swap to another Chrome window
  // under the mouse (live: WhatsApp pin → EGC Chat under cursor).
  if (
    voiceCommandTarget?.hwnd &&
    !isRippleOwnWindow(
      voiceCommandTarget.processName,
      voiceCommandTarget.windowTitle,
    ) &&
    !isWeakFocusContext(voiceCommandTarget)
  ) {
    console.info(
      `[ripple-desktop] voice target keep pin (${reason}): ${voiceCommandTarget.processName} | "${voiceCommandTarget.windowTitle.slice(0, 60)}"`,
    );
    return voiceCommandTarget;
  }

  const underMouse = await voiceTargetFromMouseFallback();
  if (underMouse) {
    return pinVoiceTarget(underMouse, `${reason}/mouse`);
  }

  for (const candidate of [lastNonRippleFocus, saved, bestStableFocus()]) {
    if (
      candidate?.hwnd &&
      !isRippleOwnWindow(candidate.processName, candidate.windowTitle) &&
      !isWeakFocusContext(candidate)
    ) {
      return pinVoiceTarget(candidate, `${reason}/memory`);
    }
  }

  try {
    const raw = await getForegroundWindow();
    if (raw?.hwnd) {
      const live = buildFocusContextFromRaw(raw);
      if (
        !isRippleOwnWindow(live.processName, live.windowTitle) &&
        !isWeakFocusContext(live)
      ) {
        return pinVoiceTarget(live, `${reason}/live_fg`);
      }
    }
  } catch {
    /* ignore */
  }

  console.warn(
    `[ripple-desktop] voice target unresolved (${reason}) — focus an editable field, then try again`,
  );
  return null;
}

function pinVoiceTarget(
  ctx: FocusContext | null,
  source: string,
): FocusContext | null {
  if (!ctx?.hwnd) return null;
  if (
    isRippleOwnWindow(ctx.processName, ctx.windowTitle) ||
    isWeakFocusContext(ctx)
  ) {
    return null;
  }
  voiceCommandTarget = ctx;
  lastNonRippleFocus = ctx;
  saved = ctx;
  console.info(
    `[ripple-desktop] voice target (${source}): ${ctx.processName} | "${ctx.windowTitle.slice(0, 60)}"`,
  );
  return ctx;
}

/** True when dictation/insert has a non-Ripple window to type into. */
export function hasDictationInsertTarget(): boolean {
  return resolveTypingFocusTarget() != null;
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

/** Chrome tab title for Google Chat (workspace DMs). */
export function isGoogleChatWindowTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (t.includes("google chat")) return true;
  if (/chat\.google\.com/i.test(title)) return true;
  // "Space Name - Chat - Google Chrome"
  if (/\s-\schat(\s-\s|$)/i.test(title) && /\b(chrome|edge|firefox|brave|opera)\b/i.test(t)) {
    return true;
  }
  return false;
}

function detectGoogleChat(title: string, url?: string): boolean {
  if (url && /chat\.google\.com/i.test(url)) return true;
  return isGoogleChatWindowTitle(title);
}

function stickyOrLastFocusIsGoogleChat(): boolean {
  for (const candidate of [lastNonRippleFocus, saved]) {
    if (
      candidate &&
      !isWeakFocusContext(candidate) &&
      (detectGoogleChat(candidate.windowTitle, candidate.activeTabUrl) ||
        (candidate.activeTabUrl && /chat\.google\.com/i.test(candidate.activeTabUrl)))
    ) {
      return true;
    }
  }
  return false;
}

/** True when Google Chat is the focused browser tab. */
export function isGoogleChatTabActive(): boolean {
  const ctx = voiceCommandTarget ?? saved;
  if (ctx && !isWeakFocusContext(ctx) && !isTransientInputShell(ctx)) {
    if (isClearlyDesktopForeground(ctx)) {
      const p = ctx.processName.toLowerCase();
      const hardDesktopLeave =
        p === "explorer" ||
        p.includes("calculator") ||
        p.includes("applicationframehost") ||
        p.includes("systemsettings");
      if (hardDesktopLeave) return false;
      if (stickyOrLastFocusIsGoogleChat()) return true;
      return false;
    }
    if (ctx.activeTabUrl && /chat\.google\.com/i.test(ctx.activeTabUrl)) return true;
    if (detectGoogleChat(ctx.windowTitle, ctx.activeTabUrl)) return true;
    return false;
  }
  return stickyOrLastFocusIsGoogleChat();
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
  const ctx = voiceCommandTarget ?? saved;
  if (!ctx?.isInstagram) return false;
  return isInstagramWindowTitle(ctx.windowTitle);
}

/**
 * True when Instagram is the intended typing surface.
 * Prefer the voice hotkey snapshot (like WhatsApp) so a stale saved IG tab
 * cannot steal inserts when the user moved to ChatGPT / Cursor / etc.
 */
export function isInstagramTabActive(): boolean {
  const ctx = voiceCommandTarget ?? saved;
  if (ctx && !isWeakFocusContext(ctx) && !isTransientInputShell(ctx)) {
    if (isClearlyDesktopForeground(ctx)) return false;
    if (ctx.isInstagram) return true;
    if (ctx.activeTabUrl && /instagram\.com/i.test(ctx.activeTabUrl)) return true;
    if (detectInstagram(ctx.windowTitle, ctx.processName, ctx.activeTabUrl)) {
      return true;
    }
    return false;
  }
  for (const candidate of [lastNonRippleFocus, saved]) {
    if (
      candidate &&
      !isWeakFocusContext(candidate) &&
      (candidate.isInstagram ||
        detectInstagram(
          candidate.windowTitle,
          candidate.processName,
          candidate.activeTabUrl,
        ) ||
        (candidate.activeTabUrl &&
          /instagram\.com/i.test(candidate.activeTabUrl)))
    ) {
      return true;
    }
  }
  return getStickyWebSurface() === "instagram";
}

export function isDesktopAppForeground(): boolean {
  const ctx = resolveTypingFocusTarget() ?? voiceCommandTarget ?? saved;
  if (!ctx?.hwnd) return false;
  return isClearlyDesktopForeground(ctx);
}

/** True when WhatsApp Web is the focused context. */
export function isWhatsAppTabActive(): boolean {
  const ctx = voiceCommandTarget ?? saved;
  if (ctx && !isWeakFocusContext(ctx) && !isTransientInputShell(ctx)) {
    // Real desktop app (Explorer folder, Calculator, …) — not WhatsApp.
    // Do NOT treat Windows "Input Flyout" as desktop leave; that flash was
    // clearing WA compose routing and causing insert-ladder double-type.
    if (isClearlyDesktopForeground(ctx)) {
      const p = ctx.processName.toLowerCase();
      const hardDesktopLeave =
        p === "explorer" ||
        p.includes("calculator") ||
        p.includes("applicationframehost") ||
        p.includes("systemsettings");
      // Soft desktop (Cursor/IDE/Notepad) must NOT kill sticky WA — otherwise
      // compose falls to focused-field + native→sendkeys and types twice into
      // the WhatsApp composer (live 2026-08-08).
      if (hardDesktopLeave) return false;
      if (stickyOrLastFocusIsWhatsApp()) return true;
      return false;
    }
    if (ctx.isWhatsApp) return true;
    if (ctx.activeTabUrl && /web\.whatsapp\.com/i.test(ctx.activeTabUrl)) return true;
    if (detectWhatsApp(ctx.windowTitle, ctx.processName)) return true;
    return false;
  }
  // Prefer sticky WhatsApp over a transient Input Flyout voice target.
  return stickyOrLastFocusIsWhatsApp() || getStickyWebSurface() === "whatsapp";
}

function stickyOrLastFocusIsWhatsApp(): boolean {
  for (const candidate of [lastNonRippleFocus, saved]) {
    if (
      candidate &&
      !isWeakFocusContext(candidate) &&
      (candidate.isWhatsApp ||
        detectWhatsApp(candidate.windowTitle, candidate.processName) ||
        (candidate.activeTabUrl &&
          /web\.whatsapp\.com/i.test(candidate.activeTabUrl)))
    ) {
      return true;
    }
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

    // While dictating, never repoint the pin to Cursor/explorer because the
    // P8 watcher polled foreground during AI rewrite (live on-off bug).
    if (
      voiceSessionFrozen &&
      voiceCommandTarget &&
      !isWeakFocusContext(voiceCommandTarget) &&
      !matchesPinnedInsertTarget(ctx, voiceCommandTarget) &&
      !isWeakFocusContext(ctx)
    ) {
      console.info(
        `[ripple-desktop] focus skip during voice — keeping pinned ${voiceCommandTarget.processName}`,
      );
      return voiceCommandTarget;
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

/**
 * Soft-yield Ripple's own windows so SetForegroundWindow can land on the
 * pinned dictation target. Delegates to setMainActivationSuppressed, which
 * guards the dangerous case: Electron's setFocusable(false) on a VISIBLE but
 * unfocused main runs Widget::Deactivate() and SetForegroundWindow's the
 * window below main in z-order — that deactivated the user's target at
 * hotkey press (Notepad surfacing). Never call setFocusable/blur here directly.
 */
export function yieldRippleForeground(): void {
  try {
    setMainActivationSuppressed(true);
  } catch {
    /* ignore */
  }
}

/** Which of our windows (if any) held focus when shell stole FG. */
function logRippleWindowsBeforeShell(reason: string): void {
  try {
    // Dynamic import avoids overlay ↔ focusContext cycle at module load.
    void import("../windows/overlay.js").then(({ describeRippleWindowsFocus }) => {
      console.warn(
        `[ripple-focus-drift] ripple_wins_before_shell reason=${reason} ${describeRippleWindowsFocus()}`,
      );
    });
  } catch {
    /* ignore */
  }
}

/**
 * Transient shell hosts (secondary-monitor taskbar, Win11 XAML explorer
 * island). They flash FG briefly and are never real typing targets —
 * restore through them instantly, no settle delay.
 */
const FAST_RESTORE_SHELL_CLASSES = new Set([
  "Shell_SecondaryTrayWnd",
  "XamlExplorerHostIslandWindow_WASDK",
]);

async function isFastRestoreShellForeground(
  fg: Pick<ForegroundWindow, "hwnd" | "className"> | null | undefined,
): Promise<boolean> {
  if (!fg?.hwnd) return false;
  let cls = (fg.className ?? "").trim();
  if (!cls) cls = await getWindowClassNameNative(Number(fg.hwnd));
  return FAST_RESTORE_SHELL_CLASSES.has(cls);
}

let lastInsertAbortReason: string | null = null;

/** Why the last ensureInsertForeground returned false (toast/error routing). */
export function getLastInsertAbortReason(): string | null {
  return lastInsertAbortReason;
}

/**
 * Re-assert pinned typing target before SendKeys/paste. Retries when Ripple
 * or a transient shell stole FG mid-insert. Fails closed — never yanks —
 * when a different REAL window owns FG: the user moved on, and force-
 * foregrounding the pin visibly switches their screen (the on/off bug).
 */
export async function ensureInsertForeground(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  lastInsertAbortReason = null;

  const fgBeforeRestore = await getForegroundWindow();
  const shellSeenAt = Date.now();
  const shellBeforeRestore =
    Boolean(fgBeforeRestore) && isDesktopShellForeground(fgBeforeRestore!);
  const pinnedPeek = resolveTypingFocusTarget();

  if (shellBeforeRestore) {
    console.warn(
      `[ripple-focus-drift] insert_fg_shell_before_restore` +
        ` t=${shellSeenAt}` +
        ` fg=${fgBeforeRestore?.processName}` +
        ` title="${(fgBeforeRestore?.windowTitle ?? "").slice(0, 40)}"` +
        ` want=${pinnedPeek?.processName ?? "?"}` +
        ` hwnd=${pinnedPeek?.hwnd ?? "?"}`,
    );
    await logShellForegroundIdentity(fgBeforeRestore!, "insert_fg_shell");
  }

  // Already on the exact hotkey hwnd — skip restore entirely so we don't burn
  // 350ms×N settle loops while WhatsApp's DOM is still settling for verify.
  if (
    fgBeforeRestore &&
    pinnedPeek &&
    !shellBeforeRestore &&
    !isRippleOwnWindow(
      fgBeforeRestore.processName ?? "",
      fgBeforeRestore.windowTitle ?? "",
    ) &&
    Number(fgBeforeRestore.hwnd) === Number(pinnedPeek.hwnd)
  ) {
    return true;
  }

  // Never yank across windows silently: if a different REAL window owns FG
  // (not Ripple, not desktop shell, not a transient input/tray host), the
  // user switched targets — abort so the caller falls back to clipboard +
  // toast instead of force-foregrounding the pin.
  if (
    fgBeforeRestore?.hwnd &&
    pinnedPeek &&
    !shellBeforeRestore &&
    Number(fgBeforeRestore.hwnd) !== Number(pinnedPeek.hwnd) &&
    !isRippleOwnWindow(
      fgBeforeRestore.processName ?? "",
      fgBeforeRestore.windowTitle ?? "",
    ) &&
    !isWeakFocusContext(buildFocusContextFromRaw(fgBeforeRestore)) &&
    !(await isFastRestoreShellForeground(fgBeforeRestore))
  ) {
    lastInsertAbortReason = "insert_aborted:target_window_changed";
    console.warn(
      `[ripple-focus-drift] insert_aborted reason=target_window_changed` +
        ` fg=${describePinCandidate(fgBeforeRestore)}` +
        ` pinned=${describePinCandidate(pinnedPeek)} (no force-foreground)`,
    );
    return false;
  }

  await restoreFocusContext();
  let fg = await getForegroundWindow();
  if (
    fg &&
    isRippleOwnWindow(fg.processName ?? "", fg.windowTitle ?? "")
  ) {
    console.info(
      "[ripple-desktop] insert FG is Ripple — yield + re-restore before typing",
    );
    yieldRippleForeground();
    await new Promise((r) => setTimeout(r, 80));
    await restoreFocusContext();
    fg = await getForegroundWindow();
  }

  if (
    fg &&
    isRippleOwnWindow(fg.processName ?? "", fg.windowTitle ?? "")
  ) {
    console.warn(
      "[ripple-desktop] insert aborted — Ripple still foreground (refusing keys/paste into Ripple)",
    );
    lastInsertAbortReason = "insert_aborted:ripple_foreground";
    return false;
  }

  const pinned = resolveTypingFocusTarget();
  if (pinned && fg && Number(fg.hwnd) !== Number(pinned.hwnd)) {
    const shellSteal = isDesktopShellForeground(fg);
    if (shellSteal) {
      console.warn(
        `[ripple-focus-drift] insert_fg_shell_before_restore` +
          ` t=${Date.now()}` +
          ` fg=${fg.processName} title="${(fg.windowTitle ?? "").slice(0, 40)}"` +
          ` want=${pinned.processName} hwnd=${pinned.hwnd}`,
      );
      await logShellForegroundIdentity(fg, "insert_fg_shell_after_restore");
    } else {
      console.warn(
        `[ripple-desktop] insert FG hwnd mismatch — want ${pinned.processName} ` +
          `(hwnd=${pinned.hwnd}) but have ${fg.processName ?? "?"} ` +
          `(hwnd=${fg.hwnd ?? "?"}) — restoring pin, not retargeting`,
      );
    }
    await restoreFocusContext();
    await new Promise((r) => setTimeout(r, 120));
    fg = await getForegroundWindow();
    if (!fg || Number(fg.hwnd) !== Number(pinned.hwnd)) {
      console.warn(
        "[ripple-desktop] insert aborted — foreground hwnd is not the hotkey-pinned window",
      );
      lastInsertAbortReason = "insert_aborted:restore_failed";
      return false;
    }
    if (shellSteal) {
      console.warn(
        `[ripple-focus-drift] insert_fg_recovered_from_shell t=${Date.now()}` +
          ` heldMs=${Date.now() - shellSeenAt}` +
          ` → ${fg.processName}` +
          ` title="${(fg.windowTitle ?? "").slice(0, 40)}"`,
      );
    }
  } else if (
    shellBeforeRestore &&
    pinned &&
    fg &&
    Number(fg.hwnd) === Number(pinned.hwnd)
  ) {
    console.warn(
      `[ripple-focus-drift] insert_fg_recovered_from_shell t=${Date.now()}` +
        ` heldMs=${Date.now() - shellSeenAt}` +
        ` → ${fg.processName}` +
        ` title="${(fg.windowTitle ?? "").slice(0, 40)}"`,
    );
  }
  return true;
}

/** True when OS foreground is the exact window pinned at hotkey (hwnd lock). */
export function matchesPinnedInsertTarget(
  fg: Pick<FocusContext, "hwnd" | "processName" | "windowTitle">,
  pinned: FocusContext,
): boolean {
  if (!fg?.hwnd || !pinned?.hwnd) return false;
  // Hard hwnd lock — never accept another Chrome/Notepad window just because
  // the title looks similar (live: WhatsApp pin → other Chrome tab paste).
  return Number(fg.hwnd) === Number(pinned.hwnd);
}

/** Same web surface despite unread-count / " - Google Chrome" suffix churn. */
export function browserTitlesCompatible(a: string, b: string): boolean {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (!la || !lb) return true;

  const surface = (t: string): string => {
    if (/whatsapp/i.test(t) || /web\.whatsapp\.com/i.test(t)) return "whatsapp";
    if (isGoogleChatWindowTitle(t) || /chat\.google\.com/i.test(t)) return "google_chat";
    if (/gmail|mail\.google/i.test(t)) return "gmail";
    if (/docs\.google|google docs/i.test(t)) return "gdocs";
    if (/sheets\.google|google sheets/i.test(t)) return "gsheets";
    if (/chatgpt|claude\.ai|chat\.openai/i.test(t)) return "ai_chat";
    if (/instagram/i.test(t)) return "instagram";
    if (/linkedin/i.test(t)) return "linkedin";
    if (/youtube/i.test(t)) return "youtube";
    if (/notion/i.test(t)) return "notion";
    return "";
  };

  const sa = surface(la);
  const sb = surface(lb);
  if (sa && sb) return sa === sb;
  if (sa || sb) return false; // one known surface, other different → refuse

  const strip = (t: string) =>
    t
      .replace(/\s*-\s*(google chrome|microsoft.?edge|firefox|brave|opera).*$/i, "")
      .replace(/^\(\d+\)\s*/, "")
      .trim();
  const ca = strip(la);
  const cb = strip(lb);
  if (!ca || !cb) return true;
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  // Distinct untitled chrome windows — require hwnd match (already checked).
  return false;
}

/**
 * After AI rewrite: restore pinned window + click web composer before insert.
 * Call immediately before captureObservation / paste.
 */
export async function prepareDictationInsertFocus(): Promise<boolean> {
  if (!(await ensureInsertForeground())) return false;
  try {
    const { ensureBrowserComposerFocus } = await import("../agent/editorFocus.js");
    await ensureBrowserComposerFocus();
  } catch {
    /* browser composer click is best-effort */
  }
  return true;
}

/**
 * Light keep-alive while AI cleanup runs (~1–4s). Prevents explorer/Cursor from
 * becoming the effective target before prepareDictationInsertFocus.
 */
export async function maintainPinnedTargetDuringRewrite(): Promise<void> {
  if (process.platform !== "win32") return;
  extendCommandFocusGrace(COMMAND_FOCUS_GRACE_MS * 2);

  const pinned = voiceCommandTarget ?? resolveTypingFocusTarget();
  if (!pinned?.hwnd) return;

  const fg = await getForegroundWindow();
  if (!fg?.hwnd) return;
  if (matchesPinnedInsertTarget(fg, pinned)) return;

  if (
    isRippleOwnWindow(fg.processName ?? "", fg.windowTitle ?? "") ||
    isWeakFocusContext(fg)
  ) {
    await restoreFocusContext();
    return;
  }

  // A REAL window (Cursor, another Chrome, …) owns FG mid-rewrite — the user
  // switched deliberately. Do NOT force-foreground the pin here; that yanks
  // the screen. ensureInsertForeground decides (and fails closed) at insert.
  console.info(
    `[ripple-desktop] rewrite FG drift ${fg.processName ?? "?"} — keeping user's window (pin ${pinned.processName} verified at insert)`,
  );
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
    // Prefer the WhatsApp/Chrome window the user is already looking at over a
    // stale voice-target hwnd (unread badge flips 55↔56; second Chrome window).
    // Yanking focus away is what feels like "WhatsApp went off the screen".
    const raw = await getForegroundWindow();
    if (raw?.hwnd) {
      const current = buildFocusContextFromRaw(raw);
      const fgIsRipple = isRippleOwnWindow(
        current.processName,
        current.windowTitle,
      );
      const sameHwnd = Number(raw.hwnd) === Number(target.hwnd);

      // Fast path: exact hotkey hwnd already owns FG. Never retarget to
      // another Chrome window with a compatible title.
      if (!fgIsRipple && sameHwnd) {
        const keep: FocusContext = {
          ...target,
          windowTitle: current.windowTitle || target.windowTitle,
        };
        saved = keep;
        lastNonRippleFocus = keep;
        voiceCommandTarget = keep;
        return true;
      }
      // Do not blur Ripple here. yieldRippleForeground() + delay hands FG to
      // explorer (blank-title shell) and causes the insert flicker. While we
      // still own FG, SetForegroundWindow can land on the pin directly.
    }

    const restoreStartedAt = Date.now();
    const fgProc = raw?.processName ?? "?";
    const fgTitle = (raw?.windowTitle ?? "").slice(0, 40);
    const shellBefore = raw ? isDesktopShellForeground(raw) : false;
    console.info(
      `[ripple-focus-drift] restore_begin t=${restoreStartedAt}` +
        ` fg=${fgProc} title="${fgTitle}"` +
        ` want=${target.processName} hwnd=${target.hwnd}` +
        `${shellBefore ? " shell=1" : ""}`,
    );
    if (shellBefore) {
      await logShellForegroundIdentity(raw!, "restore_begin_shell");
    }

    // Fast-path: secondary taskbar / XAML explorer island are transient FG
    // flashes, not real targets — restore instantly with no settle delay.
    let fgClass = (raw?.className ?? "").trim();
    if (!fgClass && raw?.hwnd && shellBefore) {
      fgClass = await getWindowClassNameNative(Number(raw.hwnd));
    }
    const fastShellRestore = FAST_RESTORE_SHELL_CLASSES.has(fgClass);

    await allowSetForegroundNative();
    await nestedForegroundLock(true);

    try {
      // Q5 — verify the OS focus call actually landed. Retry even when Cursor
      // (or any other app) holds FG — Windows often refuses the first
      // SetForegroundWindow after the user clicked elsewhere during rewrite.
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const hwndAt = Date.now();
        await focusWindowByHwnd(target.hwnd, target.windowTitle);
        const hwndMs = Date.now() - hwndAt;
        await new Promise((r) =>
          setTimeout(r, fastShellRestore ? 40 : attempt === 1 ? 350 : 220),
        );

        const after = await getForegroundWindow();
        const elapsedMs = Date.now() - restoreStartedAt;
        if (after?.hwnd && Number(after.hwnd) === Number(target.hwnd)) {
          const landed: FocusContext = {
            ...target,
            hwnd: Number(after.hwnd),
            processName: after.processName || target.processName,
            windowTitle: after.windowTitle || target.windowTitle,
          };
          saved = landed;
          lastNonRippleFocus = landed;
          voiceCommandTarget = landed;
          console.info(
            `[ripple-desktop] focus restored → ${landed.processName} | "${landed.windowTitle.slice(0, 60)}"`,
          );
          console.info(
            `[ripple-focus-drift] restore_end t=${Date.now()}` +
              ` elapsedMs=${elapsedMs} hwndCallMs=${hwndMs}` +
              ` attempt=${attempt}` +
              ` from=${fgProc} to=${landed.processName}` +
              `${shellBefore ? " recovered_shell=1" : ""}` +
              `${fastShellRestore ? " fast_shell=1" : ""}`,
          );
          return true;
        }

        if (attempt < maxAttempts) {
          console.warn(
            `[ripple-desktop] focus restore attempt ${attempt}/${maxAttempts}: ` +
              `FG is ${after?.processName ?? "?"} — retrying pin ${target.processName}`,
          );
          console.warn(
            `[ripple-focus-drift] restore_retry t=${Date.now()}` +
              ` elapsedMs=${elapsedMs} hwndCallMs=${hwndMs}` +
              ` fg=${after?.processName ?? "?"} title="${(after?.windowTitle ?? "").slice(0, 40)}"`,
          );
          // Electron snap-back: suppress main before the next SetForegroundWindow.
          if (
            after &&
            isRippleOwnWindow(after.processName ?? "", after.windowTitle ?? "")
          ) {
            yieldRippleForeground();
            await new Promise((r) => setTimeout(r, 40));
          }
          continue;
        }

        console.warn(
          `[ripple-desktop] focus restore FAILED to land — wanted ${target.processName} ` +
            `(hwnd=${target.hwnd}) but foreground is now ` +
            `${after?.processName ?? "?"} (hwnd=${after?.hwnd ?? "?"}) ` +
            `title="${(after?.windowTitle ?? "").slice(0, 60)}"`,
        );
        console.warn(
          `[ripple-focus-drift] restore_fail t=${Date.now()} elapsedMs=${elapsedMs}` +
            ` from=${fgProc} still=${after?.processName ?? "?"}`,
        );
        return false;
      }

      return false;
    } finally {
      await nestedForegroundLock(false);
    }
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] focus restore failed:",
      e instanceof Error ? e.message : e,
    );
    try {
      await nestedForegroundLock(false);
    } catch {
      /* ignore */
    }
    return false;
  }
}
