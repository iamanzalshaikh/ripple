import { beforeEach, describe, expect, it, vi } from "vitest";

const getForegroundWindow = vi.fn();
const getWindowUnderCursorNative = vi.fn();
const focusWindowByHwnd = vi.fn();

vi.mock("../../native/win32Bridge.js", () => ({
  getForegroundWindow: (...args: unknown[]) => getForegroundWindow(...args),
  getWindowUnderCursorNative: (...args: unknown[]) =>
    getWindowUnderCursorNative(...args),
  focusWindowByHwnd: (...args: unknown[]) => focusWindowByHwnd(...args),
  allowSetForegroundNative: vi.fn(async () => undefined),
  lockSetForegroundNative: vi.fn(async () => undefined),
  getWindowClassNameNative: vi.fn(async () => "Progman"),
}));

vi.mock("../../windows/mainWindow.js", () => ({
  getMainWindow: () => null,
  setMainActivationSuppressed: vi.fn(),
  isMainActivationSuppressed: () => false,
}));

vi.mock("../../storage/sessionMemory.js", () => ({
  getMemory: () => null,
  setMemory: () => undefined,
}));

describe("cold-start dictation focus hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWindowUnderCursorNative.mockResolvedValue(null);
    focusWindowByHwnd.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("pins last-good chrome when hotkey fires with Ripple in foreground", async () => {
    const focus = await import("../../focus/focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 100,
      processName: "chrome",
      windowTitle: "(60) WhatsApp - Google Chrome",
    });
    await focus.snapshotPreVoiceTarget();
    expect(focus.hasDictationInsertTarget()).toBe(true);

    getForegroundWindow.mockResolvedValue({
      hwnd: 1,
      processName: "electron",
      windowTitle: "Ripple",
    });
    const recovered = await focus.snapshotPreVoiceTarget();
    expect(recovered?.processName).toBe("chrome");
    expect(focus.resolveTypingFocusTarget()?.processName).toBe("chrome");
  });

  it("uses mouse-under-cursor when FG is weak and memory is empty", async () => {
    const focus = await import("../../focus/focusContext.js");
    getForegroundWindow.mockResolvedValue({
      hwnd: 2,
      processName: "SearchHost",
      windowTitle: "Search",
    });
    getWindowUnderCursorNative.mockResolvedValue({
      hwnd: 200,
      processName: "notepad",
      windowTitle: "Untitled - Notepad",
    });
    const target = await focus.snapshotPreVoiceTarget();
    expect(target?.processName).toBe("notepad");
    expect(focus.hasDictationInsertTarget()).toBe(true);
  });

  it("fail-closed recover returns null when only Ripple is available", async () => {
    const focus = await import("../../focus/focusContext.js");
    getForegroundWindow.mockResolvedValue({
      hwnd: 1,
      processName: "electron",
      windowTitle: "Ripple",
    });
    getWindowUnderCursorNative.mockResolvedValue(null);
    const target = await focus.recoverDictationFocusTarget("test_empty");
    expect(target).toBeNull();
    expect(focus.hasDictationInsertTarget()).toBe(false);
  });

  it("retries restore when Ripple steals FG mid-insert, then succeeds", async () => {
    const focus = await import("../../focus/focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 300,
      processName: "chrome",
      windowTitle: "EGC…Chat - Google Chrome",
    });
    await focus.snapshotPreVoiceTarget();
    expect(focus.hasDictationInsertTarget()).toBe(true);

    let focusCalls = 0;
    focusWindowByHwnd.mockImplementation(async () => {
      focusCalls += 1;
    });

    // Attempt 1: still Ripple; attempt 2: chrome lands.
    getForegroundWindow
      .mockResolvedValueOnce({
        hwnd: 1,
        processName: "electron",
        windowTitle: "Ripple",
      })
      .mockResolvedValueOnce({
        hwnd: 1,
        processName: "electron",
        windowTitle: "Ripple",
      })
      .mockResolvedValueOnce({
        hwnd: 300,
        processName: "chrome",
        windowTitle: "EGC…Chat - Google Chrome",
      });

    const ok = await focus.restoreFocusContext();
    expect(ok).toBe(true);
    expect(focusCalls).toBeGreaterThanOrEqual(2);
  });

  it("retries restore when Cursor holds FG, then succeeds", async () => {
    const focus = await import("../../focus/focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 300,
      processName: "chrome",
      windowTitle: "Google Chat",
    });
    await focus.snapshotPreVoiceTarget();

    let focusCalls = 0;
    focusWindowByHwnd.mockImplementation(async () => {
      focusCalls += 1;
    });

    getForegroundWindow
      .mockResolvedValueOnce({
        hwnd: 999,
        processName: "Cursor",
        windowTitle: "focusContext.ts",
      })
      .mockResolvedValueOnce({
        hwnd: 999,
        processName: "Cursor",
        windowTitle: "focusContext.ts",
      })
      .mockResolvedValueOnce({
        hwnd: 300,
        processName: "chrome",
        windowTitle: "Google Chat",
      });

    const ok = await focus.restoreFocusContext();
    expect(ok).toBe(true);
    expect(focusCalls).toBeGreaterThanOrEqual(2);
  });

  it("ensureInsertForeground refuses when Ripple remains FG", async () => {
    const focus = await import("../../focus/focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 400,
      processName: "chrome",
      windowTitle: "Chat",
    });
    await focus.snapshotPreVoiceTarget();

    getForegroundWindow.mockResolvedValue({
      hwnd: 1,
      processName: "electron",
      windowTitle: "Ripple",
    });

    const ok = await focus.ensureInsertForeground();
    expect(ok).toBe(false);
  });
});
