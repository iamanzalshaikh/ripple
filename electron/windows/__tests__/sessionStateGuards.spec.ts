import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rows 1.8 (rapid double-press) and 10.6 (Escape cancels cleanly).
 *
 * Both are about voice-session state, not focus mechanics: a second press must
 * not start a second session, and cancelling must leave state clean enough that
 * the NEXT press starts fresh. A session left "active" is what made a later
 * hotkey press silently fail to re-pin during live testing.
 */

const hide = vi.fn();
const showInactive = vi.fn();
const sendToOverlay = vi.fn();

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function MockBW(this: Record<string, unknown>) {
    Object.assign(this, {
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      showInactive,
      hide,
      blur: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setBounds: vi.fn(),
      setFocusable: vi.fn(),
      isFocusable: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      isFocused: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      getTitle: vi.fn(() => ""),
      getNativeWindowHandle: () => Buffer.alloc(8),
      webContents: {
        on: vi.fn(),
        send: vi.fn(),
        once: vi.fn(),
        isLoading: () => false,
      },
    });
  }),
  screen: {
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
}));

const snapshotPreVoiceTarget = vi.fn(async () => null);

vi.mock("../../focus/focusContext.js", () => ({
  extendCommandFocusGrace: vi.fn(),
  setVoiceSessionFrozen: vi.fn(),
  snapshotPreVoiceTarget: () => snapshotPreVoiceTarget(),
  resolveTypingFocusTarget: vi.fn(() => ({
    hwnd: 42,
    processName: "chrome",
    windowTitle: "WhatsApp",
  })),
  nestedForegroundLock: vi.fn(async () => undefined),
}));

vi.mock("../../native/win32Bridge.js", () => ({
  focusWindowByHwnd: vi.fn(async () => undefined),
  allowSetForegroundNative: vi.fn(async () => undefined),
  lockSetForegroundNative: vi.fn(async () => undefined),
  getForegroundWindow: vi.fn(async () => ({
    hwnd: 42,
    processName: "chrome",
    windowTitle: "WhatsApp",
  })),
  applyNoActivateStyleNative: vi.fn(async () => undefined),
}));

vi.mock("../../services/bootReadiness.js", () => ({
  isVoiceInputReady: () => true,
}));

vi.mock("../../utils/preloadPath.js", () => ({ resolvePreloadPath: () => "" }));

vi.mock("../mainWindow.js", () => ({
  setMainActivationSuppressed: vi.fn(),
  getMainWindow: () => null,
}));

const startDictationSession = vi.fn();
const startCommandSession = vi.fn();
vi.mock("../../agent/dictation/dictationSession.js", () => ({
  startDictationSession,
  startCommandSession,
  isDictationModeEnabled: () => true,
  cancelDictationSession: vi.fn(),
}));

vi.mock("../../agent/meeting/meetingRecorder.js", () => ({
  isMeetingRecording: () => false,
}));

vi.mock("../../agent/transform/transformSession.js", () => ({
  takePendingSelection: vi.fn(),
}));

describe("Row 1.8 / 10.6 — voice session state guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("1.8 — a second rapid press does NOT start a second session", async () => {
    const overlay = await import("../overlay.js");
    overlay.createOverlayWindow();

    await overlay.handleShortcutPress("dictation");
    expect(overlay.isVoiceSessionActive()).toBe(true);
    expect(startDictationSession).toHaveBeenCalledTimes(1);

    // Immediate second press — must be treated as "stop", not a new session.
    await overlay.handleShortcutPress("dictation");
    expect(startDictationSession).toHaveBeenCalledTimes(1);
    // And the pin is snapshotted only once, so the first target is preserved.
    expect(snapshotPreVoiceTarget).toHaveBeenCalledTimes(1);
  });

  it("10.6 — after cancel, the NEXT press starts a fresh session and re-pins", async () => {
    const overlay = await import("../overlay.js");
    overlay.createOverlayWindow();

    await overlay.handleShortcutPress("dictation");
    expect(overlay.isVoiceSessionActive()).toBe(true);

    // Escape / cancel path.
    overlay.setVoiceSessionActive(false);
    expect(overlay.isVoiceSessionActive()).toBe(false);

    // A stale "active" session here is what silently blocked re-pinning during
    // live testing — the next press must pin again.
    await overlay.handleShortcutPress("dictation");
    expect(startDictationSession).toHaveBeenCalledTimes(2);
    expect(snapshotPreVoiceTarget).toHaveBeenCalledTimes(2);
  });

  it("10.6 — cancelVoiceSession clears the active flag", async () => {
    const overlay = await import("../overlay.js");
    overlay.createOverlayWindow();

    await overlay.handleShortcutPress("dictation");
    expect(overlay.isVoiceSessionActive()).toBe(true);

    overlay.cancelVoiceSession();
    await new Promise((r) => setTimeout(r, 50));
    expect(overlay.isVoiceSessionActive()).toBe(false);
  });
});
