import { BrowserWindow } from "electron";
import { getOverlayWindow } from "../windows/overlay.js";

/** Hide Ripple UI so Windows can foreground Chrome for SendKeys. */
export function releaseDesktopFocus(): void {
  const overlay = getOverlayWindow();
  if (overlay && !overlay.isDestroyed()) {
    overlay.hide();
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.blur();
  }
}
