import { beforeEach, describe, expect, it, vi } from "vitest";

const blur = vi.fn();
const setFocusable = vi.fn();
const isFocused = vi.fn(() => true);
const isDestroyed = vi.fn(() => false);

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function MockBrowserWindow(this: Record<string, unknown>) {
    this.on = vi.fn();
    this.once = vi.fn();
    this.show = vi.fn();
    this.showInactive = vi.fn();
    this.focus = vi.fn();
    this.blur = blur;
    this.setFocusable = setFocusable;
    this.isFocused = isFocused;
    this.isVisible = vi.fn(() => true);
    this.isDestroyed = isDestroyed;
    this.isMinimized = vi.fn(() => false);
    this.restore = vi.fn();
    this.setAlwaysOnTop = vi.fn();
    this.moveTop = vi.fn();
    this.loadURL = vi.fn();
    this.loadFile = vi.fn();
    this.webContents = {
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
    };
  }),
  shell: { openExternal: vi.fn() },
}));

describe("mainWindow activation suppression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("setMainActivationSuppressed blurs and disables focus on main", async () => {
    const mod = await import("../../windows/mainWindow.js");
    mod.createMainWindow();
    mod.setMainActivationSuppressed(true);
    expect(setFocusable).toHaveBeenCalledWith(false);
    expect(blur).toHaveBeenCalled();
    expect(mod.isMainActivationSuppressed()).toBe(true);

    mod.setMainActivationSuppressed(false);
    expect(setFocusable).toHaveBeenCalledWith(true);
    expect(mod.isMainActivationSuppressed()).toBe(false);
  });

  it("showMainWindow uses showInactive while suppressed", async () => {
    const mod = await import("../../windows/mainWindow.js");
    const win = mod.createMainWindow() as unknown as {
      show: ReturnType<typeof vi.fn>;
      showInactive: ReturnType<typeof vi.fn>;
      focus: ReturnType<typeof vi.fn>;
      setFocusable: ReturnType<typeof vi.fn>;
    };
    mod.setMainActivationSuppressed(true);
    mod.showMainWindow();
    expect(win.showInactive).toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
    expect(win.show).not.toHaveBeenCalled();
  });

  it("showMainWindow userInitiated forces show and focus", async () => {
    const mod = await import("../../windows/mainWindow.js");
    const win = mod.createMainWindow() as unknown as {
      show: ReturnType<typeof vi.fn>;
      showInactive: ReturnType<typeof vi.fn>;
      focus: ReturnType<typeof vi.fn>;
      setFocusable: ReturnType<typeof vi.fn>;
    };
    mod.setMainActivationSuppressed(true);
    mod.showMainWindow({ userInitiated: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(mod.isMainActivationSuppressed()).toBe(false);
  });
});
