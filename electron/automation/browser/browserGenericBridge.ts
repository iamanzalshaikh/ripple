import { runInsertText } from "../actions/insertText.js";
import { clickSelector, typeIntoSelector } from "../cdp/cdpDom.js";
import { getActiveCdpPage } from "../cdp/cdpClient.js";
import { restoreFocusContext } from "../../focus/focusContext.js";
import { delay } from "../delay.js";
import { runBrowserGenericViaExtension } from "../../bridge/nativeMessagingBridge.js";

export type BrowserGenericAction =
  | "extract_text"
  | "find_element"
  | "click"
  | "type"
  | "scroll";

export type BrowserGenericPayload = {
  action: BrowserGenericAction;
  selector?: string;
  text?: string;
  ariaLabel?: string;
  partial?: boolean;
  x?: number;
  y?: number;
  deltaY?: number;
  amount?: number;
  maxChars?: number;
};

export type BrowserGenericResult = {
  ok: boolean;
  error?: string;
  detail?: string;
  text?: string;
  url?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tag?: string;
  scrollY?: number;
};

const USE_CDP = process.env.RIPPLE_USE_CDP === "1";

function parseExtensionPayload(detail?: string): Record<string, unknown> {
  if (!detail?.trim()) return {};
  try {
    return JSON.parse(detail) as Record<string, unknown>;
  } catch {
    return { detail };
  }
}

function extensionToResult(
  r: { ok: boolean; error?: string; detail?: string },
): BrowserGenericResult {
  if (!r.ok) {
    return { ok: false, error: r.error ?? "extension_failed" };
  }
  const parsed = parseExtensionPayload(r.detail);
  return {
    ok: true,
    detail:
      typeof parsed.detail === "string"
        ? parsed.detail
        : typeof r.detail === "string"
          ? r.detail
          : undefined,
    text: typeof parsed.text === "string" ? parsed.text : undefined,
    url: typeof parsed.url === "string" ? parsed.url : undefined,
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    x: typeof parsed.x === "number" ? parsed.x : undefined,
    y: typeof parsed.y === "number" ? parsed.y : undefined,
    width: typeof parsed.width === "number" ? parsed.width : undefined,
    height: typeof parsed.height === "number" ? parsed.height : undefined,
    tag: typeof parsed.tag === "string" ? parsed.tag : undefined,
    scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : undefined,
  };
}

async function tryExtension(
  payload: BrowserGenericPayload,
): Promise<BrowserGenericResult | null> {
  try {
    const r = await runBrowserGenericViaExtension(payload);
    if (!r.ok) return null;
    return extensionToResult(r);
  } catch {
    return null;
  }
}

async function desktopTypeFallback(text: string): Promise<string> {
  await restoreFocusContext();
  await delay(200);
  return runInsertText({ text });
}

async function desktopClickFallback(x: number, y: number): Promise<string> {
  await restoreFocusContext();
  await delay(150);
  return runInsertText({
    mouseAction: "click",
    x,
    y,
  });
}

async function desktopScrollFallback(amount: number): Promise<string> {
  await restoreFocusContext();
  await delay(100);
  const direction = amount >= 0 ? "down" : "up";
  return runInsertText({
    mouseAction: direction === "up" ? "scroll_up" : "scroll_down",
    scrollDelta: Math.abs(amount),
  });
}

async function tryCdpExtract(maxChars: number): Promise<BrowserGenericResult | null> {
  if (!USE_CDP) return null;
  const page = await getActiveCdpPage();
  if (!page) return null;
  const text = await page.evaluate((max) => {
    const root = document.body ?? document.documentElement;
    return (root?.innerText ?? "").trim().slice(0, max);
  }, maxChars);
  return {
    ok: true,
    text,
    url: page.url(),
    title: await page.title(),
    detail: `extracted ${text.length} chars via CDP`,
  };
}

async function tryCdpFind(payload: BrowserGenericPayload): Promise<BrowserGenericResult | null> {
  if (!USE_CDP || !payload.selector) return null;
  const page = await getActiveCdpPage();
  if (!page) return null;
  const box = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      width: Math.round(r.width),
      height: Math.round(r.height),
      tag: el.tagName,
    };
  }, payload.selector);
  if (!box) return { ok: false, error: "element_not_found" };
  return { ok: true, ...box, detail: "found via CDP" };
}

async function tryCdpClick(payload: BrowserGenericPayload): Promise<BrowserGenericResult | null> {
  if (!USE_CDP) return null;
  const page = await getActiveCdpPage();
  if (!page) return null;
  if (typeof payload.x === "number" && typeof payload.y === "number") {
    await page.mouse.click(payload.x, payload.y);
    return { ok: true, detail: `clicked@${payload.x},${payload.y} via CDP` };
  }
  if (payload.selector) {
    await clickSelector(page, payload.selector);
    return { ok: true, detail: `clicked ${payload.selector} via CDP` };
  }
  return null;
}

async function tryCdpType(payload: BrowserGenericPayload): Promise<BrowserGenericResult | null> {
  if (!USE_CDP) return null;
  const text = payload.text?.trim();
  if (!text) return { ok: false, error: "missing_text" };
  const page = await getActiveCdpPage();
  if (!page) return null;
  if (payload.selector) {
    await typeIntoSelector(page, payload.selector, text);
    return { ok: true, detail: `typed ${text.length} chars via CDP` };
  }
  await page.keyboard.type(text, { delay: 20 });
  return { ok: true, detail: `typed ${text.length} chars via CDP` };
}

async function tryCdpScroll(payload: BrowserGenericPayload): Promise<BrowserGenericResult | null> {
  if (!USE_CDP) return null;
  const page = await getActiveCdpPage();
  if (!page) return null;
  const deltaY = Number(payload.deltaY ?? payload.amount ?? 400);
  await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), deltaY);
  const scrollY = await page.evaluate(() => window.scrollY);
  return { ok: true, detail: `scrolled ${deltaY} via CDP`, scrollY };
}

export async function runBrowserGeneric(
  payload: BrowserGenericPayload,
): Promise<BrowserGenericResult> {
  const ext = await tryExtension(payload);
  if (ext?.ok) return ext;

  if (payload.action === "extract_text") {
    const maxChars = Math.min(Number(payload.maxChars) || 12000, 50000);
    const cdp = await tryCdpExtract(maxChars);
    if (cdp?.ok) return cdp;
    return { ok: false, error: ext?.error ?? "extract_text_failed" };
  }

  if (payload.action === "find_element") {
    const cdp = await tryCdpFind(payload);
    if (cdp) return cdp;
    return { ok: false, error: ext?.error ?? "element_not_found" };
  }

  if (payload.action === "click") {
    if (typeof payload.x === "number" && typeof payload.y === "number") {
      try {
        const detail = await desktopClickFallback(payload.x, payload.y);
        return { ok: true, detail, x: payload.x, y: payload.y };
      } catch (e: unknown) {
        const cdp = await tryCdpClick(payload);
        if (cdp?.ok) return cdp;
        return {
          ok: false,
          error: e instanceof Error ? e.message : "click_failed",
        };
      }
    }
    const cdp = await tryCdpClick(payload);
    if (cdp) return cdp;
    return { ok: false, error: ext?.error ?? "click_failed" };
  }

  if (payload.action === "type") {
    const text = payload.text?.trim();
    if (!text) return { ok: false, error: "missing_text" };
    try {
      const detail = await desktopTypeFallback(text);
      return { ok: true, detail };
    } catch (e: unknown) {
      const cdp = await tryCdpType(payload);
      if (cdp?.ok) return cdp;
      return {
        ok: false,
        error: e instanceof Error ? e.message : "type_failed",
      };
    }
  }

  if (payload.action === "scroll") {
    const deltaY = Number(payload.deltaY ?? payload.amount ?? 400);
    const cdp = await tryCdpScroll(payload);
    if (cdp?.ok) return cdp;
    try {
      const detail = await desktopScrollFallback(deltaY);
      return { ok: true, detail, scrollY: deltaY };
    } catch (e: unknown) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "scroll_failed",
      };
    }
  }

  return { ok: false, error: `unknown_action:${payload.action}` };
}
