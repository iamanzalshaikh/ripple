import type { Page } from "puppeteer-core";
import { delay } from "../../delay.js";
import { findAppByTarget } from "../../appRegistry.js";
import { getCdpBrowserUrl } from "../../../config/cdp.js";
import { ensureCdpBrowser, isCdpReachable } from "../../cdp/ensureBrowser.js";
import { disconnectCdp, findCdpPage } from "../../cdp/cdpClient.js";
import {
  clickSelector,
  pressKey,
  typeIntoSelector,
  waitForSelector,
} from "../../cdp/cdpDom.js";
import { matchContactWithConfidence } from "../../contacts/contactMatch.js";
import { withTimeout } from "../../recovery/timeout.js";
import { scrapeWhatsAppSessionNames } from "./whatsappContactList.js";
import { WA, WHATSAPP_WEB_URL } from "./selectors.js";
import {
  failStep,
  logWaStep,
  WhatsAppPipelineError,
} from "./whatsappSteps.js";

const USE_YOUR_CHROME_HELP =
  "Use YOUR Chrome WhatsApp tab (no extra window):\n" +
  "1) Quit all Chrome\n" +
  '2) Chrome shortcut Target → add: --remote-debugging-port=9222\n' +
  "3) Start Chrome from that shortcut only\n" +
  "4) Open https://web.whatsapp.com (stay logged in)\n" +
  "5) Remove RIPPLE_LAUNCH_CDP=1 from .env (that opens a second Chrome)";

function isDetachError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /Target closed|Session closed|Protocol error/i.test(m);
}

function firstSelector(csv: string): string {
  return csv.split(",")[0]!.trim();
}

function isPageUsable(page: Page): boolean {
  try {
    return !page.isClosed();
  } catch {
    return false;
  }
}

async function queryAnyVisible(page: Page, csv: string): Promise<boolean> {
  for (const sel of csv.split(",").map((s) => s.trim())) {
    try {
      const el = await page.$(sel);
      if (el) {
        const box = await el.boundingBox();
        if (box && box.width > 0 && box.height > 0) return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function waitForWhatsAppReady(page: Page): Promise<void> {
  if (!isPageUsable(page)) {
    failStep("wa_ui_ready", "WhatsApp tab closed while loading");
  }

  await withTimeout("WhatsApp load", 90_000, async () => {
    await delay(2000);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-icon="search"]') ||
        document.querySelector("#side") ||
        document.querySelector('[aria-label="Search input textbox"]') ||
        document.querySelector('[data-testid="chat-list"]'),
      { timeout: 90_000 },
    );
  });
  logWaStep("wa_ui_ready", true);
}

/** Reuse an existing web.whatsapp.com tab — never open a duplicate tab unless separate profile. */
async function acquireWhatsAppPage(): Promise<Page> {
  const allowSeparateChrome = process.env.RIPPLE_LAUNCH_CDP === "1";
  let connected = await isCdpReachable();
  logWaStep("cdp_connected", connected, getCdpBrowserUrl());

  if (!connected) {
    if (!allowSeparateChrome) {
      failStep("cdp_connected", USE_YOUR_CHROME_HELP);
    }
    console.warn(
      "[ripple-desktop] RIPPLE_LAUNCH_CDP=1 — opening separate automation Chrome (not your daily profile)",
    );
    await ensureCdpBrowser({ allowLaunch: true });
    connected = await isCdpReachable();
    logWaStep("cdp_connected", connected, "automation Chrome profile");
    if (!connected) {
      failStep("cdp_connected", USE_YOUR_CHROME_HELP);
    }
  }

  const app = findAppByTarget("whatsapp")!;
  const existing = await findCdpPage(app);

  if (existing && isPageUsable(existing)) {
    logWaStep("tab_found", true, `reusing ${existing.url().slice(0, 55)}`);
    try {
      await existing.bringToFront();
    } catch {
      /* ignore */
    }
    await delay(1500);
    if (!existing.url().includes("web.whatsapp.com")) {
      await existing.goto(WHATSAPP_WEB_URL, {
        waitUntil: "networkidle2",
        timeout: 120_000,
      });
      await delay(3000);
    }
    return existing;
  }

  if (!allowSeparateChrome) {
    failStep(
      "tab_found",
      `No WhatsApp tab on CDP. Open web.whatsapp.com in YOUR Chrome (with --remote-debugging-port=9222). ${USE_YOUR_CHROME_HELP}`,
    );
  }

  failStep(
    "tab_found",
    "Automation Chrome has no WhatsApp tab. Log in at web.whatsapp.com in the ripple-cdp-chrome window once.",
  );
}

async function validatedSearchAndOpenContact(
  page: Page,
  contactName: string,
): Promise<void> {
  const searchSel = firstSelector(WA.searchBox);
  const searchVisible = await queryAnyVisible(page, WA.searchBox);
  logWaStep("search_box_found", searchVisible, searchSel);
  if (!searchVisible) {
    failStep(
      "search_box_found",
      "WhatsApp search box not found — log in to WhatsApp Web or update selectors.ts",
    );
  }

  await waitForSelector(page, searchSel, 20_000);
  await clickSelector(page, searchSel);
  await typeIntoSelector(page, searchSel, contactName);
  await delay(900);

  const contactFound = await page.evaluate((name) => {
    const spans = Array.from(document.querySelectorAll("span[title]"));
    return spans.some((s) =>
      (s.getAttribute("title") ?? "").toLowerCase().includes(name.toLowerCase()),
    );
  }, contactName);

  logWaStep("contact_found", contactFound, contactName);
  if (!contactFound) {
    failStep(
      "contact_found",
      `No chat matching "${contactName}" in your WhatsApp session`,
    );
  }

  await pressKey(page, "Enter");
  await delay(900);

  const clicked = await page.evaluate((name) => {
    const spans = Array.from(document.querySelectorAll("span[title]"));
    const match = spans.find((s) =>
      (s.getAttribute("title") ?? "").toLowerCase().includes(name.toLowerCase()),
    );
    if (!match) return false;
    (match as HTMLElement).click();
    return true;
  }, contactName);

  logWaStep("chat_opened", clicked, contactName);
  if (!clicked) {
    failStep("chat_opened", `Could not open chat for "${contactName}"`);
  }

  await delay(600);
}

async function validatedInsertMessage(
  page: Page,
  text: string,
  send: boolean,
): Promise<void> {
  const inputSel = firstSelector(WA.chatInput);
  const inputVisible = await queryAnyVisible(page, WA.chatInput);
  logWaStep("message_input_found", inputVisible, inputSel);
  if (!inputVisible) {
    failStep(
      "message_input_found",
      "Message input not found — chat may not be open",
    );
  }

  await waitForSelector(page, inputSel, 15_000);
  await clickSelector(page, inputSel);
  await typeIntoSelector(page, inputSel, text, true);
  await delay(400);

  const snippet = text.slice(0, 40);
  const inserted = await page.evaluate(
    (sel, snippetText) => {
      const parts = sel.split(",").map((s: string) => s.trim());
      for (const s of parts) {
        const el = document.querySelector(s);
        if (!el) continue;
        const t = (el.textContent ?? "").trim();
        if (t.includes(snippetText)) return true;
      }
      return false;
    },
    WA.chatInput,
    snippet,
  );

  logWaStep("message_inserted", inserted, `${text.length} chars`);
  if (!inserted) {
    failStep("message_inserted", "Message did not appear in the chat input");
  }

  if (send) {
    await pressKey(page, "Enter");
    await delay(500);
    logWaStep("message_sent", true);
  } else {
    logWaStep("message_sent", false, "send=false (draft only)");
  }
}

export interface WhatsAppCdpPipelineInput {
  contact: string;
  text: string;
  send: boolean;
  rawContact: string;
}

/**
 * Primary: type name in WhatsApp search (WhatsApp finds the chat).
 * Fallback: fuzzy-correct spelling using recent sidebar names only.
 */
async function resolveSearchQuery(
  page: Page,
  confirmedContact: string,
  rawContact: string,
): Promise<string> {
  let query = confirmedContact.trim() || rawContact.trim();
  logWaStep("search_strategy", true, `whatsapp_ui_search for "${query}"`);

  try {
    const sessionNames = await scrapeWhatsAppSessionNames(page);
    logWaStep("session_names_loaded", sessionNames.length > 0, `${sessionNames.length} recent chats`);

    if (sessionNames.length > 0) {
      const match = matchContactWithConfidence(rawContact, {
        whatsAppSessionNames: sessionNames,
      });
      if (
        match.tier === "auto" &&
        match.best.name.toLowerCase() !== query.toLowerCase()
      ) {
        logWaStep(
          "fuzzy_correction",
          true,
          `${query} → ${match.best.name} (sidebar hint)`,
        );
        query = match.best.name;
      }
    }
  } catch {
    logWaStep("session_names_loaded", false, "skipped — using transcript name");
  }

  logWaStep("search_query", true, query);
  return query;
}

export async function runWhatsAppCdpPipeline(
  input: WhatsAppCdpPipelineInput,
): Promise<string> {
  logWaStep("pipeline_start", true, `contact="${input.contact}"`);

  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const page = await acquireWhatsAppPage();
      await waitForWhatsAppReady(page);

      const searchName = await resolveSearchQuery(
        page,
        input.contact,
        input.rawContact,
      );

      await validatedSearchAndOpenContact(page, searchName);
      await validatedInsertMessage(page, input.text, input.send);

      logWaStep("pipeline_complete", true);
      if (input.send) {
        return `WhatsApp: sent to ${searchName}`;
      }
      return `WhatsApp: message ready for ${searchName} (not sent)`;
    } catch (e: unknown) {
      lastError = e;
      if (e instanceof WhatsAppPipelineError) {
        logWaStep("pipeline_complete", false, `failed at ${e.step}`);
        throw e;
      }
      if (isDetachError(e) && attempt < 2) {
        console.warn(
          `[ripple-desktop] WhatsApp tab detached (attempt ${attempt}) — retrying`,
        );
        await disconnectCdp();
        await delay(2000);
        continue;
      }
      logWaStep(
        "pipeline_complete",
        false,
        e instanceof Error ? e.message : String(e),
      );
      throw e;
    }
  }

  throw lastError;
}
