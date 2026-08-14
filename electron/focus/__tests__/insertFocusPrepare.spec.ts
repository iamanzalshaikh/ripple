import { beforeEach, describe, expect, it, vi } from "vitest";

const getForegroundWindow = vi.fn();
const focusWindowByHwnd = vi.fn();
const getWindowUnderCursorNative = vi.fn();
const clickBrowserComposerNative = vi.fn();

vi.mock("../../native/win32Bridge.js", () => ({
  getForegroundWindow: (...args: unknown[]) => getForegroundWindow(...args),
  focusWindowByHwnd: (...args: unknown[]) => focusWindowByHwnd(...args),
  getWindowUnderCursorNative: (...args: unknown[]) =>
    getWindowUnderCursorNative(...args),
  getFocusedA11yElement: vi.fn(async () => ({
    controlType: "ControlType.Group",
    name: "",
    automationId: "",
    className: "",
  })),
  clickBrowserComposerNative: (...args: unknown[]) =>
    clickBrowserComposerNative(...args),
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

describe("dictation insert focus prepare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    focusWindowByHwnd.mockResolvedValue(undefined);
    clickBrowserComposerNative.mockResolvedValue({ ok: true, x: 100, y: 200 });
    vi.resetModules();
  });

  it("matchesPinnedInsertTarget requires the hotkey hwnd (no silent Chrome retarget)", async () => {
    const focus = await import("../focusContext.js");
    const pinnedWa = {
      hwnd: 2,
      processName: "chrome",
      windowTitle: "(62) WhatsApp - Google Chrome",
      capturedAt: 0,
      isGmail: false,
      isWhatsApp: true,
      isSlack: false,
      isNotion: false,
      isYouTube: false,
      isLinkedIn: false,
      isInstagram: false,
      isBrowser: true,
    };
    // Badge churn on the SAME hwnd is fine.
    expect(
      focus.matchesPinnedInsertTarget(
        { hwnd: 2, processName: "chrome", windowTitle: "(63) WhatsApp - Google Chrome" },
        pinnedWa,
      ),
    ).toBe(true);
    // Different Chrome window — even another WhatsApp tab — must not match.
    expect(
      focus.matchesPinnedInsertTarget(
        {
          hwnd: 1,
          processName: "chrome",
          windowTitle: "(63) WhatsApp - Google Chrome",
        },
        pinnedWa,
      ),
    ).toBe(false);
    expect(
      focus.matchesPinnedInsertTarget(
        {
          hwnd: 9,
          processName: "chrome",
          windowTitle: "EGC India Shopping club - Chat - Google Chrome",
        },
        pinnedWa,
      ),
    ).toBe(false);
  });

  it("ensureInsertForeground aborts when a different Chrome hwnd holds FG", async () => {
    const focus = await import("../focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 300,
      processName: "chrome",
      windowTitle: "(59) WhatsApp - Google Chrome",
    });
    await focus.snapshotPreVoiceTarget();

    // Another Chrome window stole FG; restore cannot land on pin hwnd.
    getForegroundWindow.mockResolvedValue({
      hwnd: 999,
      processName: "chrome",
      windowTitle: "EGC India Shopping club - Chat - Google Chrome",
    });
    focusWindowByHwnd.mockResolvedValue(undefined);

    const ok = await focus.ensureInsertForeground();
    expect(ok).toBe(false);
  });

  it("ensureInsertForeground rejects Cursor when pinned target is chrome", async () => {
    const focus = await import("../focusContext.js");

    getForegroundWindow.mockImplementation(async () => ({
      hwnd: 300,
      processName: "chrome",
      windowTitle: "Google Chat",
    }));
    await focus.snapshotPreVoiceTarget();

    getForegroundWindow.mockImplementation(async () => ({
      hwnd: 999,
      processName: "Cursor",
      windowTitle: "focusContext.ts",
    }));

    const ok = await focus.ensureInsertForeground();
    expect(ok).toBe(false);
  });

  it("recoverDictationFocusTarget keeps hotkey pin even when mouse is over another Chrome window", async () => {
    const focus = await import("../focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 300,
      processName: "chrome",
      windowTitle: "(59) WhatsApp - Google Chrome",
    });
    await focus.snapshotPreVoiceTarget();

    getWindowUnderCursorNative.mockResolvedValue({
      hwnd: 999,
      processName: "chrome",
      windowTitle: "EGC India Shopping club - Chat - Google Chrome",
    });

    const kept = await focus.recoverDictationFocusTarget("pre_insert");
    expect(kept?.hwnd).toBe(300);
    expect(kept?.windowTitle).toMatch(/WhatsApp/i);
  });

  it("ensureInsertForeground recovers Program Manager shell steal and logs focus-drift", async () => {
    const focus = await import("../focusContext.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    getForegroundWindow.mockResolvedValue({
      hwnd: 500,
      processName: "chrome",
      windowTitle: "(1) WhatsApp - Google Chrome",
    });
    await focus.snapshotPreVoiceTarget();

    let calls = 0;
    getForegroundWindow.mockImplementation(async () => {
      calls += 1;
      // First peek (before restore) is desktop shell; later peeks are chrome.
      if (calls === 1) {
        return {
          hwnd: 1,
          processName: "explorer",
          windowTitle: "Program Manager",
        };
      }
      return {
        hwnd: 500,
        processName: "chrome",
        windowTitle: "(1) WhatsApp - Google Chrome",
      };
    });

    const ok = await focus.ensureInsertForeground();
    expect(ok).toBe(true);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("[ripple-focus-drift] insert_fg_shell_before_restore"),
      ),
    ).toBe(true);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("[ripple-focus-drift] insert_fg_recovered_from_shell"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("restoreFocusContext locks SetForegroundWindow around the hwnd restore", async () => {
    const { lockSetForegroundNative } = await import("../../native/win32Bridge.js");
    const focus = await import("../focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 500,
      processName: "chrome",
      windowTitle: "(1) WhatsApp - Google Chrome",
    });
    await focus.snapshotPreVoiceTarget();

    getForegroundWindow.mockResolvedValue({
      hwnd: 1,
      processName: "explorer",
      windowTitle: "",
    });
    focusWindowByHwnd.mockImplementation(async () => {
      getForegroundWindow.mockResolvedValue({
        hwnd: 500,
        processName: "chrome",
        windowTitle: "(1) WhatsApp - Google Chrome",
      });
    });

    const ok = await focus.restoreFocusContext();
    expect(ok).toBe(true);
    expect(lockSetForegroundNative).toHaveBeenCalledWith(true);
    expect(lockSetForegroundNative).toHaveBeenCalledWith(false);
    const order = vi.mocked(lockSetForegroundNative).mock.calls.map((c) => c[0]);
    expect(order[0]).toBe(true);
    expect(order[order.length - 1]).toBe(false);
  });

  it("restoreFocusContext skips OS restore when FG already matches the pin", async () => {
    const { lockSetForegroundNative } = await import("../../native/win32Bridge.js");
    const focus = await import("../focusContext.js");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    getForegroundWindow.mockResolvedValue({
      hwnd: 500,
      processName: "chrome",
      windowTitle: "(1) WhatsApp - Google Chrome",
    });
    await focus.snapshotPreVoiceTarget();

    focusWindowByHwnd.mockClear();
    vi.mocked(lockSetForegroundNative).mockClear();

    const ok = await focus.restoreFocusContext();
    expect(ok).toBe(true);
    expect(focusWindowByHwnd).not.toHaveBeenCalled();
    expect(lockSetForegroundNative).not.toHaveBeenCalled();
    expect(
      info.mock.calls.some((c) => String(c[0]).includes("restore_begin")),
    ).toBe(false);

    info.mockRestore();
  });

  it("ensureInsertForeground is a no-op when FG already matches the pin", async () => {
    const focus = await import("../focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 500,
      processName: "chrome",
      windowTitle: "(1) WhatsApp - Google Chrome",
    });
    await focus.snapshotPreVoiceTarget();

    focusWindowByHwnd.mockClear();
    const ok = await focus.ensureInsertForeground();
    expect(ok).toBe(true);
    expect(focusWindowByHwnd).not.toHaveBeenCalled();
  });

  it("prepareDictationInsertFocus clicks browser composer after restore", async () => {
    const focus = await import("../focusContext.js");

    getForegroundWindow.mockResolvedValue({
      hwnd: 400,
      processName: "chrome",
      windowTitle: "EGC India Shopping club - Chat",
    });
    await focus.snapshotPreVoiceTarget();

    getForegroundWindow.mockResolvedValue({
      hwnd: 400,
      processName: "chrome",
      windowTitle: "EGC India Shopping club - Chat",
    });

    const ok = await focus.prepareDictationInsertFocus();
    expect(ok).toBe(true);
    expect(clickBrowserComposerNative).toHaveBeenCalledWith({ hwnd: 400 });
  });
});
