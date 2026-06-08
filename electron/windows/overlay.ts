import { BrowserWindow, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureFocusContext } from "../focus/focusContext.js";
import { resolvePreloadPath } from "../utils/preloadPath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const INDICATOR_WIDTH = 220;
const INDICATOR_HEIGHT = 56;
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

function sendToOverlay(channel: string, payload: unknown): void {
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

export function setOverlayState(state: string): void {
  sendToOverlay("overlay:state", state);
}

export function dismissOverlay(delayMs = 1500): void {
  setTimeout(() => {
    hideOverlay();
    setOverlayState("idle");
    setVoiceSessionActive(false);
  }, delayMs);
}

export function cancelVoiceSession(): void {
  sendToOverlay("overlay:voice-toggle", { action: "cancel" });
  setOverlayState("idle");
  setVoiceSessionActive(false);
  dismissOverlay(300);
}

export async function handleShortcutPress(): Promise<void> {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }

  if (voiceSessionActive) {
    sendToOverlay("overlay:voice-toggle", { action: "stop" });
    setOverlayState("processing");
    return;
  }

  // Capture before overlay; skip if foreground is Ripple — we find Chrome WhatsApp at execute time
  await captureFocusContext();
  showOverlay();
  setVoiceSessionActive(true);
  setOverlayState("listening");
  sendToOverlay("overlay:voice-toggle", { action: "start" });
}
