import { BrowserWindow, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extendCommandFocusGrace,
  nestedForegroundLock,
  resolveTypingFocusTarget,
  setVoiceSessionFrozen,
  snapshotPreVoiceTarget,
} from "../focus/focusContext.js";
import { isVoiceInputReady } from "../services/bootReadiness.js";
import { resolvePreloadPath } from "../utils/preloadPath.js";
import { setMainActivationSuppressed, getMainWindow } from "./mainWindow.js";
import {
  allowSetForegroundNative,
  focusWindowByHwnd,
  getForegroundWindow,
} from "../native/win32Bridge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// P11.1 rebuild — sized for the Flow Bar's icon ring + waveform + monospace
// status text + divider + language/session badges (the old plain pill was
// narrower and shorter; this redesign needs the extra room).
// P11.3/11.4 — room for language badge + Scratchpad + Transforms wand.
const INDICATOR_WIDTH = 328;
const INDICATOR_HEIGHT = 60;
const BOTTOM_MARGIN = 32;

let overlayWindow: BrowserWindow | null = null;
let voiceSessionActive = false;
let overlayReady = false;

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

/**
 * Electron's setFocusable(false) on Windows ends in Widget::Deactivate() —
 * it SetForegroundWindow's the next window below in z-order even when this
 * window never had focus. Only flip when focusable is actually on, so
 * repeated show/hide cycles on the (visible) overlay can't deactivate the
 * user's foreground app.
 */
function dropFocusable(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  try {
    if (typeof win.isFocusable !== "function" || win.isFocusable()) {
      win.setFocusable(false);
    }
  } catch {
    /* ignore */
  }
}

export function isVoiceSessionActive(): boolean {
  return voiceSessionActive;
}

export function setVoiceSessionActive(active: boolean): void {
  voiceSessionActive = active;
  setVoiceSessionFrozen(active);
  // Main titled "Ripple" must not re-activate during dictation — that is the
  // restore_fail from=electron snap-back loop after SetForegroundWindow.
  setMainActivationSuppressed(active);
}

function positionIndicator(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const x = Math.round(area.x + (area.width - INDICATOR_WIDTH) / 2);
  const y = Math.round(area.y + area.height - INDICATOR_HEIGHT - BOTTOM_MARGIN);
  win.setBounds({
    x,
    y,
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT,
  });
}

export function sendToOverlay(channel: string, payload: unknown): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  const deliver = () => {
    overlayWindow?.webContents.send(channel, payload);
  };

  if (overlayReady && !overlayWindow.webContents.isLoading()) {
    deliver();
    return;
  }

  overlayWindow.webContents.once("did-finish-load", () => {
    overlayReady = true;
    deliver();
  });
}

export function createOverlayWindow(): BrowserWindow {
  overlayReady = false;

  overlayWindow = new BrowserWindow({
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const base = process.env.ELECTRON_RENDERER_URL;
  if (base) {
    const sep = base.includes("?") ? "&" : "?";
    overlayWindow.loadURL(`${base}${sep}overlay=1`);
  } else {
    overlayWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { overlay: "1" },
    });
  }

  overlayWindow.webContents.on("did-finish-load", () => {
    overlayReady = true;
    applyOverlayNoActivate(overlayWindow);
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
    voiceSessionActive = false;
    overlayReady = false;
  });

  // Never accept keyboard focus even if Electron briefly flips focusable.
  overlayWindow.on("focus", () => {
    try {
      dropFocusable(overlayWindow);
      overlayWindow?.blur();
    } catch {
      /* ignore */
    }
  });

  positionIndicator(overlayWindow);
  applyOverlayNoActivate(overlayWindow);
  return overlayWindow;
}

/** HWND from Electron BrowserWindow (Win32). */
function overlayNativeHwnd(win: BrowserWindow): number | null {
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || buf.length < 4) return null;
    if (buf.length >= 8) return Number(buf.readBigUInt64LE(0));
    return buf.readUInt32LE(0);
  } catch {
    return null;
  }
}

function applyOverlayNoActivate(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed() || process.platform !== "win32") return;
  dropFocusable(win);
  const hwnd = overlayNativeHwnd(win);
  if (!hwnd) return;
  void import("../native/win32Bridge.js").then(({ applyNoActivateStyleNative }) => {
    void applyNoActivateStyleNative(hwnd);
  });
}

export function showOverlay(): void {
  // Suppress main before any BrowserWindow show — Electron app activation
  // otherwise brings title="Ripple" to the foreground.
  setMainActivationSuppressed(true);
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }
  dropFocusable(overlayWindow);
  positionIndicator(overlayWindow);
  applyOverlayNoActivate(overlayWindow);
  overlayWindow.showInactive();
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  applyOverlayNoActivate(overlayWindow);
}

export function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Language/code-repair paths briefly set focusable=true; force off before
    // hide so Windows does not activate Ripple chrome as the next FG window.
    dropFocusable(overlayWindow);
    overlayWindow.hide();
  }
  // Do not blur the main window here. hide + blur leaves a FG vacuum that
  // Windows fills with explorer (blank title / Program Manager) — the
  // insert flicker. Callers must claim the pinned target BEFORE hide
  // (see hideOverlayToPinnedTarget).
}

/**
 * Claim the pinned typing hwnd first, then hide the overlay — while a
 * short-lived LockSetForegroundWindow is held — so FG never passes through
 * explorer. Order: SetForegroundWindow(pin) → hide. Never hide-then-restore.
 */
export async function hideOverlayToPinnedTarget(): Promise<boolean> {
  const pin = resolveTypingFocusTarget();

  // If the pin ALREADY owns the foreground, do not touch it at all: the
  // Focus-Hwnd ritual (AppActivate/AttachThreadInput/Alt-tap) on an
  // already-foreground Chrome poisons its input state so the next Ctrl+V
  // is swallowed (proven live 2026-08-14 — the failed-paste bug). No lock
  // was acquired here, so there is nothing to unlock — just hide.
  if (pin?.hwnd) {
    const fg = await getForegroundWindow();
    if (fg?.hwnd && Number(fg.hwnd) === Number(pin.hwnd)) {
      console.info(
        `[ripple-insert] hide_overlay pin_already_fg hwnd=${pin.hwnd} — hide only, no focus call`,
      );
      hideOverlay();
      return true;
    }
  }

  let locked = false;
  try {
    await allowSetForegroundNative();
    await nestedForegroundLock(true);
    locked = true;
    if (pin?.hwnd) {
      await focusWindowByHwnd(pin.hwnd, pin.windowTitle);
      // Tiny settle under lock so the OS commits FG before hide.
      await new Promise((r) => setTimeout(r, 40));
    }
    hideOverlay();
    return Boolean(pin?.hwnd);
  } catch (e: unknown) {
    console.warn(
      "[ripple-focus-drift] hideOverlayToPinnedTarget failed:",
      e instanceof Error ? e.message : e,
    );
    hideOverlay();
    return false;
  } finally {
    if (locked) {
      try {
        await nestedForegroundLock(false);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Sync snapshot of our BrowserWindows for shell-steal forensics. */
export function describeRippleWindowsFocus(): string {
  const describe = (label: string, win: BrowserWindow | null): string => {
    if (!win || win.isDestroyed()) return `${label}=none`;
    try {
      return (
        `${label}={focused=${win.isFocused()}` +
        ` visible=${win.isVisible()}` +
        ` focusable=${typeof win.isFocusable === "function" ? win.isFocusable() : "?"}` +
        ` title="${(win.getTitle?.() ?? "").slice(0, 24)}"}`
      );
    } catch {
      return `${label}=err`;
    }
  };
  return `${describe("main", getMainWindow())} ${describe("overlay", overlayWindow)}`;
}

export function expandOverlayForDisambiguation(itemCount: number): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = 380;
  const height =
    itemCount <= 0
      ? 88
      : Math.min(300, 72 + Math.max(1, itemCount) * 40);
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + area.height - height - BOTTOM_MARGIN);
  overlayWindow.setBounds({ x, y, width, height });
  overlayWindow.showInactive();
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
}

/**
 * P11.2 — Flow Bar language picker. Renderer-initiated (button click), unlike
 * the other expand* functions here which are all pushed from backend events.
 * Briefly focusable so the menu buttons reliably receive clicks, same as
 * expandOverlayForCodeRepair.
 */
export function expandOverlayForLanguageMenu(itemCount: number): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = 260;
  const height = Math.min(360, 108 + Math.max(1, itemCount) * 28);
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + area.height - height - BOTTOM_MARGIN);
  overlayWindow.setBounds({ x, y, width, height });
  overlayWindow.setFocusable(true);
  overlayWindow.showInactive();
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
}

/** Collapse back to the normal small pill after a Flow Bar menu closes. */
export function collapseOverlayToIndicator(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  dropFocusable(overlayWindow);
  positionIndicator(overlayWindow);
}

/** Larger overlay for the code-repair fix panel (error + actions). */
export function expandOverlayForCodeRepair(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = 420;
  const height = 320;
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + area.height - height - BOTTOM_MARGIN);
  overlayWindow.setBounds({ x, y, width, height });
  // Briefly focusable so Apply/Open/Ignore buttons receive clicks reliably.
  overlayWindow.setFocusable(true);
  overlayWindow.showInactive();
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
}

export function resetOverlaySize(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  dropFocusable(overlayWindow);
  positionIndicator(overlayWindow);
}

/** Larger overlay for Meeting Notetaker privacy consent. */
export function expandOverlayForMeetingConsent(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = 400;
  const height = 320;
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + area.height - height - BOTTOM_MARGIN);
  overlayWindow.setBounds({ x, y, width, height });
  overlayWindow.setFocusable(true);
  overlayWindow.showInactive();
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
}

export function setOverlayState(state: string): void {
  sendToOverlay("overlay:state", state);
}

export function showBootStartingOverlay(): void {
  showOverlay();
  sendToOverlay("overlay:boot", { ready: false, message: "Starting up…" });
  sendToOverlay("overlay:state", "processing");
}

export function hideBootStartingOverlay(): void {
  sendToOverlay("overlay:boot", { ready: true });
  sendToOverlay("overlay:state", "idle");
  hideOverlay();
}

let insertFailureHintUntil = 0;

export function isInsertFailureHintActive(): boolean {
  return Date.now() < insertFailureHintUntil;
}

/** Brief Flow Bar hint when OS insert fails (wrong app / no focus). */
export function showDictationInsertFailure(message: string): void {
  const text = message.trim().slice(0, 120);
  if (!text) return;
  insertFailureHintUntil = Date.now() + 3400;
  showOverlay();
  sendToOverlay("overlay:state", "error");
  sendToOverlay("overlay:transform-hint", { message: text });
  setTimeout(() => {
    insertFailureHintUntil = 0;
    hideOverlay();
    setOverlayState("idle");
  }, 3200);
}

export function showClarifyQuestionOnOverlay(question: string): void {
  const q = question.trim().slice(0, 200);
  if (!q) return;
  showOverlay();
  expandOverlayForDisambiguation(0);
  sendToOverlay("overlay:clarify", { question: q });
}

export function dismissOverlay(delayMs = 1500): void {
  setTimeout(() => {
    void hideOverlayToPinnedTarget().then(() => {
      setOverlayState("idle");
      setVoiceSessionActive(false);
      extendCommandFocusGrace();
    });
  }, delayMs);
}

export function cancelVoiceSession(): void {
  // P10.2 — Esc during a meeting stops it (with summary flush via Overlay).
  void import("../agent/meeting/meetingRecorder.js").then(({ isMeetingRecording }) => {
    if (isMeetingRecording()) {
      sendToOverlay("overlay:meeting-toggle", { action: "stop" });
      setOverlayState("processing");
      return;
    }
    sendToOverlay("overlay:voice-toggle", { action: "cancel" });
    setOverlayState("idle");
    setVoiceSessionActive(false);
    dismissOverlay(300);
    void import("../agent/dictation/dictationSession.js").then((m) => {
      m.cancelDictationSession();
    });
    // A cancelled recording must not leak a stashed selection into the next,
    // unrelated dictation utterance.
    void import("../agent/transform/transformSession.js").then((m) => {
      m.takePendingSelection();
    });
  });
}

export async function handleShortcutPress(
  mode: "command" | "dictation" = "command",
  // P8.4 naming: "uiMode" is display-only (Overlay banner/hotkey hint). It
  // must never collide with Ripple's existing "Command" (Ctrl+Space agent)
  // label, so Transforms reports itself as "transform" here even though it
  // reuses the "dictation" session/IPC plumbing internally.
  uiMode: "command" | "dictation" | "transform" = mode,
): Promise<void> {
  if (!isVoiceInputReady()) {
    showBootStartingOverlay();
    console.info("[ripple-desktop] hotkey ignored — still starting up");
    return;
  }

  // P10.2 — meeting owns the mic; route voice hotkeys to meeting stop instead.
  try {
    const { isMeetingRecording } = await import(
      "../agent/meeting/meetingRecorder.js"
    );
    if (isMeetingRecording()) {
      await handleMeetingShortcutPress();
      return;
    }
  } catch {
    /* ignore */
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }

  if (voiceSessionActive) {
    sendToOverlay("overlay:voice-toggle", { action: "stop", mode: uiMode });
    setOverlayState("processing");
    return;
  }

  // press_sequence forensics — FG before ANY window-touching call in the
  // press path (setVoiceSessionActive → suppression is the first toucher).
  const pressT0 = Date.now();
  const fgBefore =
    process.platform === "win32" ? await getForegroundWindow() : null;

  const { startCommandSession, startDictationSession } = await import(
    "../agent/dictation/dictationSession.js"
  );
  if (mode === "dictation") {
    startDictationSession();
  } else {
    startCommandSession();
  }

  // Snapshot target app before overlay steals attention (do not re-capture FG here)
  // Suppress Ripple main *before* snapshot/overlay — first-boot ready-to-show
  // otherwise activates title="Ripple" mid-hotkey.
  setVoiceSessionActive(true);
  await snapshotPreVoiceTarget();
  showOverlay();
  // Second snapshot right after overlay show; do not await — press latency
  // stays unchanged, the log lands asynchronously.
  const fgAfterOverlayPromise =
    process.platform === "win32" ? getForegroundWindow() : Promise.resolve(null);
  setOverlayState("listening");
  sendToOverlay("overlay:voice-toggle", { action: "start", mode: uiMode });
  if (process.platform === "win32") {
    const fgAfterSessionPromise = getForegroundWindow();
    void Promise.all([fgAfterOverlayPromise, fgAfterSessionPromise]).then(
      ([fgAfterOverlay, fgAfterSession]) => {
        const fmt = (
          fg: { processName?: string; hwnd?: number } | null,
        ): string => (fg?.hwnd ? `${fg.processName ?? "?"}:${fg.hwnd}` : "none");
        const changed =
          Number(fgBefore?.hwnd ?? 0) !== Number(fgAfterOverlay?.hwnd ?? 0) ||
          Number(fgBefore?.hwnd ?? 0) !== Number(fgAfterSession?.hwnd ?? 0);
        console.info(
          `[ripple-focus-drift] press_sequence t=${pressT0}` +
            ` durMs=${Date.now() - pressT0}` +
            ` fg_before=${fmt(fgBefore)}` +
            ` fg_after_overlay=${fmt(fgAfterOverlay)}` +
            ` fg_after_session_start=${fmt(fgAfterSession)}` +
            `${changed ? " FG_CHANGED=1" : ""}`,
        );
      },
    );
  }
}

/**
 * P8 — Transforms entry point (F9 primary; Ctrl+Alt+Space backup).
 * Naming (P8.4): Wispr's own materials call this "Command Mode" in pricing
 * copy and "Transforms" in newer docs. Ripple already uses "Command" for the
 * Ctrl+Space agent/planner mode (see hotkeyRegistry's "Command mode" label),
 * so reusing that name here would collide with an unrelated, already-shipped
 * feature. This module — and every user-facing surface — calls it
 * "Transforms" only. Never label this "Command Mode".
 *
 * Captures the highlighted selection BEFORE the overlay can steal focus,
 * stashes it, then hands off to the normal dictation start/stop/insert
 * pipeline unchanged — executeDictationUtterance branches on the stashed
 * selection to run the rewrite instead of a plain insert.
 */
let transformHotkeyBusy = false;

/**
 * P8 — Transforms entry point (F9 primary; Ctrl+Alt+Space backup).
 * Naming (P8.4): Wispr's own materials call this "Command Mode" in pricing
 * copy and "Transforms" in newer docs. Ripple already uses "Command" for the
 * Ctrl+Space agent/planner mode (see hotkeyRegistry's "Command mode" label),
 * so reusing that name here would collide with an unrelated, already-shipped
 * feature. This module — and every user-facing surface — calls it
 * "Transforms" only. Never label this "Command Mode".
 *
 * Captures the highlighted selection BEFORE the overlay can steal focus,
 * stashes it, then hands off to the normal dictation start/stop/insert
 * pipeline unchanged — executeDictationUtterance branches on the stashed
 * selection to run the rewrite instead of a plain insert.
 */
export async function handleTransformShortcutPress(): Promise<void> {
  if (!isVoiceInputReady()) {
    showBootStartingOverlay();
    return;
  }
  try {
    if (voiceSessionActive) {
      await handleShortcutPress("dictation", "transform");
      return;
    }
    // Block double-F9 while Ctrl+C selection capture is in flight.
    if (transformHotkeyBusy) return;
    transformHotkeyBusy = true;

    const { readSelectedText } = await import("../agent/transform/selectionCapture.js");
    const selection = await readSelectedText();
    if (!selection) {
      console.warn(
        "[ripple-desktop] Transforms (F9): NO TEXT SELECTED — highlight text in the target app, then press F9",
      );
      showOverlay();
      sendToOverlay("overlay:state", "error");
      sendToOverlay("overlay:transform-hint", {
        message: "Select text first, then F9",
      });
      setTimeout(() => hideOverlay(), 2500);
      return;
    }

    const { setPendingSelection } = await import("../agent/transform/transformSession.js");
    setPendingSelection(selection);
    console.info(
      `[ripple-desktop] Transforms (F9): selection captured (${selection.length} chars) — speak rewrite instruction`,
    );
    await handleShortcutPress("dictation", "transform");
  } catch (err) {
    console.error("[ripple-desktop] Transforms (F9) failed:", err);
    showOverlay();
    sendToOverlay("overlay:transform-hint", {
      message: "Transforms failed — try again",
    });
    setTimeout(() => hideOverlay(), 2500);
  } finally {
    transformHotkeyBusy = false;
  }
}

let quickCaptureBusy = false;

async function openNoteInMainWindow(note: {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}): Promise<void> {
  const { setActiveNoteId } = await import("../state/activeNoteFocus.js");
  setActiveNoteId(note.id);

  void import("../sync/syncClient.js").then((m) =>
    m.pushSyncItemAsync("note", note.id, {
      title: note.title,
      body: note.body,
      createdAt: note.createdAt,
    }),
  );

  const { showMainWindow, getMainWindow } = await import("../windows/mainWindow.js");
  showMainWindow();
  getMainWindow()?.webContents.send("notes:quickCapture", { noteId: note.id });
}

/**
 * P10.3 lite — Quick capture hotkey: create a note, bring the main window
 * to the Notes editor for it, and start dictating into it immediately.
 * Windows-only equivalent of the iOS widget/Action Button version (out of
 * scope here).
 */
export async function handleQuickCaptureShortcutPress(): Promise<void> {
  if (!isVoiceInputReady()) {
    showBootStartingOverlay();
    return;
  }
  if (voiceSessionActive || quickCaptureBusy) return;
  quickCaptureBusy = true;
  try {
    const { createNote } = await import("../storage/notes.js");
    const note = createNote({ title: "Quick capture", body: "" });
    await openNoteInMainWindow(note);

    // Give the renderer time to switch to the Notes editor and focus the
    // body textarea (which self-reports via notes:setActiveNote) before
    // starting dictation — otherwise focusedFieldDictation's editable-focus
    // check can fire too early and reject the utterance.
    setTimeout(() => {
      void handleShortcutPress("dictation");
    }, 550);
  } catch (err) {
    console.error("[ripple-desktop] Quick capture failed:", err);
  } finally {
    quickCaptureBusy = false;
  }
}

/**
 * P11.3 — Flow Bar Scratchpad / Notes button.
 * Opens (or creates) a scratchpad note and routes dictation into it.
 * If a voice session is already running, the next insert lands in the note
 * without restarting the mic. If idle, starts dictation after the editor opens.
 */
export async function handleScratchpadFromFlowBar(): Promise<void> {
  if (quickCaptureBusy) return;
  quickCaptureBusy = true;
  try {
    const { createNote } = await import("../storage/notes.js");
    const note = createNote({ title: "Scratchpad", body: "" });
    await openNoteInMainWindow(note);
    console.info(
      `[ripple-desktop] Flow Bar scratchpad — note ${note.id.slice(0, 8)} (voice=${voiceSessionActive})`,
    );

    if (!voiceSessionActive) {
      setTimeout(() => {
        void handleShortcutPress("dictation");
      }, 550);
    }
  } catch (err) {
    console.error("[ripple-desktop] Flow Bar scratchpad failed:", err);
  } finally {
    quickCaptureBusy = false;
  }
}

/**
 * P10.2 — Meeting Notetaker toggle (Ctrl+Shift+M, Flow Bar stop, or voice
 * "start/stop meeting"). Mic capture runs in the Overlay after state starts.
 * First start requires explicit privacy consent (Wispr-style disclosure).
 */
export async function handleMeetingShortcutPress(): Promise<void> {
  if (!isVoiceInputReady()) {
    showBootStartingOverlay();
    return;
  }
  try {
    const {
      startMeetingRecording,
      isMeetingRecording,
      getMeetingState,
      isMeetingConsentGranted,
    } = await import("../agent/meeting/meetingRecorder.js");

    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = createOverlayWindow();
    }
    showOverlay();

    if (isMeetingRecording()) {
      // Overlay owns the final flush → meeting:end.
      setOverlayState("processing");
      sendToOverlay("overlay:meeting-toggle", { action: "stop" });
      return;
    }

    // Don't steal the mic from an active dictation/command session.
    if (voiceSessionActive) {
      sendToOverlay("overlay:transform-hint", {
        message: "Finish voice first, then start meeting",
      });
      setOverlayState("error");
      setTimeout(() => setOverlayState("idle"), 2200);
      return;
    }

    // P10.2b — explicit consent before any recording / cloud upload.
    if (!isMeetingConsentGranted()) {
      expandOverlayForMeetingConsent();
      sendToOverlay("overlay:meeting-consent", { show: true });
      return;
    }

    await startMeetingRecording();
    const snap = getMeetingState();
    if (snap.state === "recording") {
      collapseOverlayToIndicator();
      setOverlayState("listening");
    }
  } catch (err) {
    console.error("[ripple-desktop] Meeting toggle failed:", err);
    showOverlay();
    setOverlayState("error");
    sendToOverlay("overlay:transform-hint", {
      message: "Meeting failed — try again",
    });
    setTimeout(() => setOverlayState("idle"), 2500);
  }
}

/** Accept meeting disclosure → persist consent → start recording. */
export async function acceptMeetingConsentAndStart(): Promise<void> {
  const { acceptMeetingConsent, startMeetingRecording, getMeetingState } =
    await import("../agent/meeting/meetingRecorder.js");
  acceptMeetingConsent();
  sendToOverlay("overlay:meeting-consent", { show: false });
  collapseOverlayToIndicator();
  showOverlay();
  await startMeetingRecording();
  const snap = getMeetingState();
  if (snap.state === "recording") {
    setOverlayState("listening");
  }
}

/** Decline meeting disclosure — do not record. */
export async function declineMeetingConsentAndClose(): Promise<void> {
  const { declineMeetingConsent } = await import(
    "../agent/meeting/meetingRecorder.js"
  );
  declineMeetingConsent();
  sendToOverlay("overlay:meeting-consent", { show: false });
  collapseOverlayToIndicator();
  hideOverlay();
  setOverlayState("idle");
}

/** Triple-tap detection on dictation hotkey → meeting toggle (when idle). */
const meetingTapTimes: number[] = [];
let meetingTapTimer: ReturnType<typeof setTimeout> | null = null;

export function handleDictationHotkeyWithMeetingTripleTap(): void {
  if (!isVoiceInputReady()) {
    showBootStartingOverlay();
    console.info("[ripple-desktop] dictation hotkey ignored — still starting up");
    return;
  }
  // Mid-utterance: always stop immediately — never wait for triple-tap.
  if (voiceSessionActive) {
    void handleShortcutPress("dictation");
    return;
  }

  void import("../agent/meeting/meetingRecorder.js").then(({ isMeetingRecording }) => {
    if (isMeetingRecording()) {
      // Dictation hotkey during meeting stops the meeting (same as meeting hotkey).
      void handleMeetingShortcutPress();
      return;
    }

    const now = Date.now();
    while (meetingTapTimes.length && now - meetingTapTimes[0]! > 850) {
      meetingTapTimes.shift();
    }
    meetingTapTimes.push(now);

    if (meetingTapTimes.length >= 3) {
      if (meetingTapTimer) {
        clearTimeout(meetingTapTimer);
        meetingTapTimer = null;
      }
      meetingTapTimes.length = 0;
      void handleMeetingShortcutPress();
      return;
    }

    if (meetingTapTimer) clearTimeout(meetingTapTimer);
    meetingTapTimer = setTimeout(() => {
      meetingTapTimer = null;
      meetingTapTimes.length = 0;
      void handleShortcutPress("dictation");
    }, 380);
  });
}
