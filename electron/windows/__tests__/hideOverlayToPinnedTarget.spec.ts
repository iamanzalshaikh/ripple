import { beforeEach, describe, expect, it, vi } from "vitest";

const hide = vi.fn();
const setFocusable = vi.fn();
const isDestroyed = vi.fn(() => false);
const isFocused = vi.fn(() => false);
const isVisible = vi.fn(() => true);
const isFocusable = vi.fn(() => false);
const getTitle = vi.fn(() => "");

const focusWindowByHwnd = vi.fn(async () => undefined);
const allowSetForegroundNative = vi.fn(async () => undefined);
const lockSetForegroundNative = vi.fn(async () => undefined);
const getForegroundWindow = vi.fn(async () => ({
  hwnd: 7,
  processName: "explorer",
  windowTitle: "",
}));

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function MockBW(this: Record<string, unknown>) {
    Object.assign(this, {
      on: vi.fn(),
      once: vi.fn(),
      showInactive: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setBounds: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      hide,
      setFocusable,
      isDestroyed,
      isFocused,
      isVisible,
      isFocusable,
      getTitle,
      webContents: {
        on: vi.fn(),
        send: vi.fn(),
        isLoading: () => false,
        once: vi.fn(),
      },
      getNativeWindowHandle: () => Buffer.alloc(8),
    });
  }),
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));

vi.mock("../../native/win32Bridge.js", () => ({
  focusWindowByHwnd: (...a: unknown[]) => focusWindowByHwnd(...a),
  allowSetForegroundNative: (...a: unknown[]) => allowSetForegroundNative(...a),
  lockSetForegroundNative: (...a: unknown[]) => lockSetForegroundNative(...a),
  getForegroundWindow: (...a: unknown[]) => getForegroundWindow(...a),
  applyNoActivateStyleNative: vi.fn(async () => undefined),
}));

vi.mock("../../focus/focusContext.js", () => ({
  extendCommandFocusGrace: vi.fn(),
  setVoiceSessionFrozen: vi.fn(),
  snapshotPreVoiceTarget: vi.fn(async () => null),
  resolveTypingFocusTarget: vi.fn(() => ({
    hwnd: 42,
    processName: "chrome",
    windowTitle: "WhatsApp",
  })),
  nestedForegroundLock: vi.fn(async (lock: boolean) => {
    await lockSetForegroundNative(lock);
  }),
}));

vi.mock("../../services/bootReadiness.js", () => ({
  isVoiceInputReady: () => true,
}));

vi.mock("../../utils/preloadPath.js", () => ({
  resolvePreloadPath: () => "",
}));

vi.mock("../mainWindow.js", () => ({
  setMainActivationSuppressed: vi.fn(),
  getMainWindow: () => null,
}));

describe("hideOverlayToPinnedTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("claims pin hwnd before hide, under a single FG lock", async () => {
    const order: string[] = [];
    allowSetForegroundNative.mockImplementation(async () => {
      order.push("allow");
    });
    lockSetForegroundNative.mockImplementation(async (lock: boolean) => {
      order.push(lock ? "lock" : "unlock");
    });
    focusWindowByHwnd.mockImplementation(async () => {
      order.push("focus");
    });
    hide.mockImplementation(() => {
      order.push("hide");
    });

    const overlay = await import("../overlay.js");
    overlay.createOverlayWindow();
    await overlay.hideOverlayToPinnedTarget();

    expect(order).toEqual(["allow", "lock", "focus", "hide", "unlock"]);
    expect(focusWindowByHwnd).toHaveBeenCalledWith(42, "WhatsApp");
  });

  it("hides WITHOUT any focus call when the pin already owns the foreground", async () => {
    // The Focus-Hwnd ritual on an already-foreground Chrome poisons its input
    // state (next Ctrl+V swallowed) — the failed-paste bug.
    getForegroundWindow.mockResolvedValue({
      hwnd: 42,
      processName: "chrome",
      windowTitle: "WhatsApp",
    });
    hide.mockClear();
    focusWindowByHwnd.mockClear();
    lockSetForegroundNative.mockClear();

    const overlay = await import("../overlay.js");
    overlay.createOverlayWindow();
    const ok = await overlay.hideOverlayToPinnedTarget();

    expect(ok).toBe(true);
    expect(hide).toHaveBeenCalled();
    expect(focusWindowByHwnd).not.toHaveBeenCalled();
    expect(lockSetForegroundNative).not.toHaveBeenCalled();
  });
});
