import { shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hideOverlay } from "../windows/overlay.js";

const execFileAsync = promisify(execFile);

/**
 * Open a URL in the default browser.
 * URLs with `&` must not use bare `cmd start` — cmd treats `&` as command separators.
 */
export async function openUrlInBrowser(url: string): Promise<void> {
  hideOverlay();

  if (process.platform === "win32") {
    const escaped = url.replace(/'/g, "''");
    await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Start-Process '${escaped}'`,
      ],
      { windowsHide: true },
    );
    return;
  }

  const ok = await shell.openExternal(url);
  if (ok) return;

  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }

  await execFileAsync("xdg-open", [url]);
}
