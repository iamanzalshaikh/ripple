import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { findAppByTarget, type AppDefinition } from "../appRegistry.js";
import { getCdpBrowserUrl } from "../../config/cdp.js";
import { ensureCdpBrowser, isCdpReachable } from "./ensureBrowser.js";

let browser: Browser | null = null;

export async function getCdpBrowser(allowLaunch = false): Promise<Browser> {
  await ensureCdpBrowser({ allowLaunch });
  if (browser?.connected) return browser;

  browser = await puppeteer.connect({
    browserURL: getCdpBrowserUrl(),
    defaultViewport: null,
  });

  browser.on("disconnected", () => {
    browser = null;
  });

  return browser;
}

function isPageAlive(page: Page): boolean {
  try {
    return !page.isClosed();
  } catch {
    return false;
  }
}

export async function findCdpPage(app: AppDefinition): Promise<Page | null> {
  if (!(await isCdpReachable())) return null;
  const b = await getCdpBrowser(false);
  const pages = await b.pages();
  for (const p of pages) {
    if (!isPageAlive(p)) continue;
    try {
      if (app.urlPattern.test(p.url())) return p;
    } catch {
      continue;
    }
  }
  return null;
}

export interface GetOrOpenPageResult {
  page: Page;
  reused: boolean;
}

export async function getOrOpenPage(
  app: AppDefinition,
  options?: { allowLaunch?: boolean },
): Promise<GetOrOpenPageResult> {
  const allowLaunch =
    options?.allowLaunch === true && process.env.RIPPLE_LAUNCH_CDP === "1";

  if (!(await isCdpReachable())) {
    if (!allowLaunch) {
      throw new Error("CDP not available");
    }
    await ensureCdpBrowser({ allowLaunch: true });
  }

  const existing = await findCdpPage(app);
  if (existing) {
    try {
      await existing.bringToFront();
      console.info(
        `[ripple-desktop] CDP: reusing ${app.id} tab — ${existing.url().slice(0, 60)}`,
      );
      return { page: existing, reused: true };
    } catch {
      console.warn("[ripple-desktop] CDP tab died — opening fresh tab");
    }
  }

  if (!allowLaunch) {
    throw new Error(
      `No live ${app.id} tab in CDP. Use your normal Chrome with WhatsApp focused.`,
    );
  }

  const b = await getCdpBrowser(true);
  const page = await b.newPage();
  await page.goto(app.openUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  return { page, reused: false };
}

export async function disconnectCdp(): Promise<void> {
  if (browser?.connected) {
    await browser.disconnect();
  }
  browser = null;
}

/** Active tab URL from CDP when reachable (optional context for backend). */
export async function getCdpActiveTabUrl(): Promise<string | undefined> {
  if (!(await isCdpReachable())) return undefined;
  try {
    const b = await getCdpBrowser(false);
    const pages = await b.pages();
    for (const p of pages) {
      if (!isPageAlive(p)) continue;
      const url = p.url();
      if (url && url !== "about:blank") return url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
