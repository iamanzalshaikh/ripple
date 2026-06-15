import { shell } from "electron";
import { hideOverlay } from "../windows/overlay.js";

/**
 * Open a URL in the default browser.
 * Uses Electron shell — handles `&` and special chars without spawning PowerShell.
 */
export async function openUrlInBrowser(url: string): Promise<void> {
  hideOverlay();
  await shell.openExternal(url);
}
