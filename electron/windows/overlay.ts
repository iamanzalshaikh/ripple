import { BrowserWindow, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extendCommandFocusGrace,
  setVoiceSessionFrozen,
  snapshotPreVoiceTarget,
} from "../focus/focusContext.js";
import { resolvePreloadPath } from "../utils/preloadPath.js";

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

export function isVoiceSessionActive(): boolean {
  return voiceSessionActive;
}

export function setVoiceSessionActive(active: boolean): void {
  voiceSessionActive = active;
  setVoiceSessionFrozen(active);
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
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
    voiceSessionActive = false;
    overlayReady = false;
  });

  positionIndicator(overlayWindow);
  return overlayWindow;
}

export function showOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }
  positionIndicator(overlayWindow);
  overlayWindow.showInactive();
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
}

export function hideOverlay(): void {
  overlayWindow?.hide();
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
  overlayWindow.setFocusable(false);
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
  overlayWindow.setFocusable(false);
  positionIndicator(overlayWindow);
}

export function setOverlayState(state: string): void {
  sendToOverlay("overlay:state", state);
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
    hideOverlay();
    setOverlayState("idle");
    setVoiceSessionActive(false);
    extendCommandFocusGrace();
  }, delayMs);
}

export function cancelVoiceSession(): void {
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
}

export async function handleShortcutPress(
  mode: "command" | "dictation" = "command",
  // P8.4 naming: "uiMode" is display-only (Overlay banner/hotkey hint). It
  // must never collide with Ripple's existing "Command" (Ctrl+Space agent)
  // label, so Transforms reports itself as "transform" here even though it
  // reuses the "dictation" session/IPC plumbing internally.
  uiMode: "command" | "dictation" | "transform" = mode,
): Promise<void> {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }

  if (voiceSessionActive) {
    sendToOverlay("overlay:voice-toggle", { action: "stop", mode: uiMode });
    setOverlayState("processing");
    return;
  }

  const { startCommandSession, startDictationSession } = await import(
    "../agent/dictation/dictationSession.js"
  );
  if (mode === "dictation") {
    startDictationSession();
  } else {
    startCommandSession();
  }

  // Snapshot target app before overlay steals attention (do not re-capture FG here)
  await snapshotPreVoiceTarget();
  showOverlay();
  setVoiceSessionActive(true);
  setOverlayState("listening");
  sendToOverlay("overlay:voice-toggle", { action: "start", mode: uiMode });
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
        "[ripple-desktop] Transforms (F9): NO TEXT SELECTED — blue-highlight text in Notepad first, then press F9",
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
