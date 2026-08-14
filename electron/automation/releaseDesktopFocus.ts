import { BrowserWindow } from "electron";
import { getOverlayWindow } from "../windows/overlay.js";

/**
 * Hide Ripple UI so Windows can foreground the typing target for SendKeys.
 * Do NOT blur every BrowserWindow — that drops FG to explorer (shell blink).
 * Prefer hideOverlayToPinnedTarget on dictation/insert paths.
 */
export function releaseDesktopFocus(): void {
  const overlay = getOverlayWindow();
  if (overlay && !overlay.isDestroyed()) {
    try {
      overlay.setFocusable(false);
    } catch {
      /* ignore */
    }
    overlay.hide();
  }

  // Soft-yield only windows that currently hold keyboard focus — never a
  // blanket blur of the whole app (that hands FG to the shell).
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      if (win.isFocused()) win.blur();
    } catch {
      /* ignore */
    }
  }
}
