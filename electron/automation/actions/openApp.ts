import { getFocusContext } from "../../focus/focusContext.js";
import { findAppByTarget } from "../appRegistry.js";
import { findCdpPage } from "../cdp/cdpClient.js";
import { isAlreadyInTargetApp } from "../appFocus.js";
import { resolveAppUrl } from "../appTargets.js";
import { openUrlInBrowser } from "../openUrl.js";

export async function runOpenApp(data?: Record<string, unknown>): Promise<string> {
  const target = typeof data?.target === "string" ? data.target : undefined;
  const url = resolveAppUrl(
    target,
    typeof data?.url === "string" ? data.url : undefined,
  );

  if (!url) {
    throw new Error(
      target
        ? `No URL known for "${target}". Backend should include data.url.`
        : "OPEN_APP missing target or url",
    );
  }

  const ctx = getFocusContext();
  const app = findAppByTarget(target ?? "");

  if (target && isAlreadyInTargetApp(target, ctx)) {
    console.info(
      `[ripple-desktop] OPEN_APP skipped — already in ${target} (${ctx?.processName})`,
    );
    return `Already in ${target} — continuing in current window`;
  }

  if (app) {
    try {
      const existing = await findCdpPage(app);
      if (existing) {
        await existing.bringToFront();
        console.info(
          `[ripple-desktop] OPEN_APP skipped — ${app.id} tab already open in CDP browser`,
        );
        return `Already open: ${target ?? app.id} (CDP tab reused)`;
      }
    } catch {
      /* CDP offline — fall through to URL open */
    }
  }

  await openUrlInBrowser(url);
  return target ? `Opened ${target}` : `Opened ${url}`;
}

export async function runOpenUrl(data?: Record<string, unknown>): Promise<string> {
  const url = typeof data?.url === "string" ? data.url : undefined;
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("OPEN_URL missing valid data.url");
  }
  await openUrlInBrowser(url);
  return `Opened ${url}`;
}
