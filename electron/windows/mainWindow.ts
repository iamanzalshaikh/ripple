import { BrowserWindow, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePreloadPath } from "../utils/preloadPath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
/** While true, main must not take FG (dictation / transforms / insert). */
let mainActivationSuppressed = false;
/** WS_EX_NOACTIVATE applied natively (visible-unfocused suppression path). */
let mainNativeNoActivateApplied = false;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function isMainActivationSuppressed(): boolean {
  return mainActivationSuppressed;
}

/** HWND from the main BrowserWindow (Win32). */
function mainNativeHwnd(win: BrowserWindow): number | null {
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || buf.length < 4) return null;
    if (buf.length >= 8) return Number(buf.readBigUInt64LE(0));
    return buf.readUInt32LE(0);
  } catch {
    return null;
  }
}

/**
 * Make main non-activatable WITHOUT deactivating anyone else.
 *
 * Electron's setFocusable(false) on Windows ends in Widget::Deactivate(),
 * which SetForegroundWindow's the next visible window BELOW main in z-order —
 * even when main never had focus. With main open in the background this
 * deactivated the user's target at hotkey press and visibly surfaced the
 * window behind main (e.g. Notepad) — and the press itself is what grants
 * Electron the foreground rights that let that stray activation succeed.
 * So Electron's call is only safe when main is hidden (Focus(false) early-
 * returns) or when main itself holds FG (deactivating IS the intended yield).
 */
function applyMainSuppression(main: BrowserWindow, reason: string): void {
  const focused = main.isFocused();
  const visible =
    typeof main.isVisible === "function" ? main.isVisible() : false;
  const focusable =
    typeof main.isFocusable === "function" ? main.isFocusable() : true;
  let branch: string;
  if (!focusable) {
    branch = "already_nonfocusable";
  } else if (focused) {
    // Main owns FG — Electron's deactivate-to-next lands on the previous app.
    main.setFocusable(false);
    if (main.isFocused()) main.blur();
    branch = "focused_yield";
  } else if (!visible) {
    // Hidden window: Electron's Focus(false) early-returns — safe.
    main.setFocusable(false);
    branch = "hidden";
  } else if (mainNativeNoActivateApplied) {
    branch = "native_already_applied";
  } else {
    // Visible but NOT focused — the dangerous case. Set WS_EX_NOACTIVATE
    // natively (zero activation side effects); the focus-event blur below
    // stays as backstop if Windows activates main anyway.
    const hwnd = mainNativeHwnd(main);
    if (hwnd) {
      mainNativeNoActivateApplied = true;
      void import("../native/win32Bridge.js").then(
        ({ setWindowNoActivateNative }) => setWindowNoActivateNative(hwnd, true),
      );
    }
    branch = "visible_native_noactivate";
  }
  console.info(
    `[ripple-focus-drift] main_suppress t=${Date.now()} branch=${branch} reason=${reason} visible=${visible} focused=${focused}`,
  );
}

/**
 * Prevent the titled "Ripple" BrowserWindow from re-taking foreground during
 * dictation. Windows will otherwise snap FG back to Electron after
 * SetForegroundWindow(chrome) — the restore_fail from=electron loop.
 */
export function setMainActivationSuppressed(suppressed: boolean): void {
  mainActivationSuppressed = suppressed;
  const main = mainWindow;
  if (!main || main.isDestroyed()) return;
  try {
    if (suppressed) {
      applyMainSuppression(main, "suppress");
    } else {
      main.setFocusable(true);
      // Clear the natively-set WS_EX_NOACTIVATE too (Electron clears its own).
      if (mainNativeNoActivateApplied) {
        mainNativeNoActivateApplied = false;
        const hwnd = mainNativeHwnd(main);
        if (hwnd) {
          void import("../native/win32Bridge.js").then(
            ({ setWindowNoActivateNative }) =>
              setWindowNoActivateNative(hwnd, false),
          );
        }
      }
    }
  } catch {
    /* ignore */
  }
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 520,
    title: "Ripple",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Do NOT call show() here. Boot arms hotkeys before createMainWindow(); a
  // late ready-to-show → show() steals FG from Chrome mid first dictation
  // (title="Ripple", process=electron) and causes multi-second restore fights.
  // Login / tray / activate paths call showMainWindow() explicitly.
  mainWindow.on("ready-to-show", () => {
    if (process.env.ELECTRON_RENDERER_URL && process.env.RIPPLE_DEVTOOLS === "1") {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });

  mainWindow.on("focus", () => {
    if (!mainActivationSuppressed) return;
    try {
      mainWindow?.blur();
    } catch {
      /* ignore */
    }
  });

  mainWindow.on("show", () => {
    if (!mainActivationSuppressed || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    try {
      // Route through the guarded suppression — a raw setFocusable(false)+blur
      // here deactivates whatever the user is focused on (Widget::Deactivate).
      applyMainSuppression(mainWindow, "show_event");
    } catch {
      /* ignore */
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  const url = process.env.ELECTRON_RENDERER_URL;
  if (url) {
    mainWindow.loadURL(url);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function showMainWindow(options?: { userInitiated?: boolean }): void {
  void presentMainWindow(options);
}

async function presentMainWindow(options?: { userInitiated?: boolean }): Promise<void> {
  const userInitiated = options?.userInitiated ?? false;

  const bringToFront = async (win: BrowserWindow): Promise<void> => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.setFocusable(true);

    if (mainNativeNoActivateApplied) {
      mainNativeNoActivateApplied = false;
      const hwnd = mainNativeHwnd(win);
      if (hwnd) {
        const { setWindowNoActivateNative } = await import("../native/win32Bridge.js");
        await setWindowNoActivateNative(hwnd, false).catch(() => undefined);
      }
    }

    win.setAlwaysOnTop(true, "screen-saver");
    win.show();
    win.focus();
    win.moveTop();
    win.setAlwaysOnTop(false);

    console.info(
      `[ripple-desktop] main window open userInitiated=${userInitiated} visible=${typeof win.isVisible === "function" ? win.isVisible() : "?"} focused=${typeof win.isFocused === "function" ? win.isFocused() : "?"}`,
    );
  };

  if (userInitiated) {
    mainActivationSuppressed = false;
  }

  if (!mainWindow) {
    const win = createMainWindow();
    win.once("ready-to-show", () => {
      void (async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (userInitiated || !mainActivationSuppressed) {
          await bringToFront(mainWindow);
          return;
        }
        mainWindow.setFocusable(false);
        mainWindow.showInactive();
      })();
    });
    return;
  }

  if (userInitiated || !mainActivationSuppressed) {
    await bringToFront(mainWindow);
    return;
  }

  if (typeof mainWindow.isVisible !== "function" || !mainWindow.isVisible()) {
    mainWindow.setFocusable(false);
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.showInactive();
}
