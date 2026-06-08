import { spawn, type ChildProcess } from "node:child_process";
import {
  findChromeExecutable,
  getCdpBrowserUrl,
  getCdpPort,
  getCdpUserDataDir,
} from "../../config/cdp.js";

let chromeChild: ChildProcess | null = null;
let lastLaunchAt = 0;

export async function isCdpReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${getCdpBrowserUrl()}/json/version`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Launch Chrome with CDP + isolated profile (works while normal Chrome is open). */
function launchCdpChrome(): void {
  const exe = findChromeExecutable();
  if (!exe) return;

  const port = getCdpPort();
  const profile = getCdpUserDataDir();

  console.info(
    `[ripple-desktop] launching CDP Chrome port=${port} profile=${profile}`,
  );

  chromeChild = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--remote-allow-origins=*`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://web.whatsapp.com",
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );

  chromeChild.on("error", (err) => {
    console.error("[ripple-desktop] CDP Chrome spawn error:", err.message);
  });

  chromeChild.unref();
  lastLaunchAt = Date.now();
}

export interface EnsureCdpOptions {
  /** If false, never spawn a new Chrome window (use when user already has WhatsApp open). */
  allowLaunch?: boolean;
}

/**
 * Connect to Chrome DevTools Protocol.
 * Retries launch only when allowLaunch is true (default).
 */
export async function ensureCdpBrowser(
  options: EnsureCdpOptions = {},
): Promise<void> {
  const envLaunch = process.env.RIPPLE_LAUNCH_CDP === "1";
  const allowLaunch = options.allowLaunch !== false && envLaunch;

  if (await isCdpReachable()) {
    console.info(`[ripple-desktop] CDP ready at ${getCdpBrowserUrl()}`);
    return;
  }

  if (!allowLaunch) {
    throw new Error(
      "CDP not connected to your Chrome. Ripple uses your existing WhatsApp window (set RIPPLE_LAUNCH_CDP=1 only if you want a separate automation browser).",
    );
  }

  const exe = findChromeExecutable();
  if (!exe) {
    throw new Error(
      "Chrome/Edge not found. Set RIPPLE_CHROME_PATH or install Google Chrome.",
    );
  }

  const port = getCdpPort();
  const now = Date.now();
  if (now - lastLaunchAt > 3000) {
    console.warn(
      `[ripple-desktop] CDP not on port ${port}. Starting automation Chrome (separate profile — log in once).`,
    );
    launchCdpChrome();
  }

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isCdpReachable()) {
      console.info("[ripple-desktop] CDP browser ready");
      return;
    }
    if (i === 20 && Date.now() - lastLaunchAt > 3000) {
      console.warn("[ripple-desktop] CDP slow — retrying Chrome launch...");
      launchCdpChrome();
    }
  }

  throw new Error(
    `CDP not reachable at ${getCdpBrowserUrl()} after ${(maxAttempts * 500) / 1000}s. ` +
      `Run manually: "${exe}" --remote-debugging-port=${port} --remote-allow-origins=* ` +
      `--user-data-dir="${getCdpUserDataDir()}"`,
  );
}
