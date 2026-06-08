import type { KeyInput, Page } from "puppeteer-core";
import { withTimeout } from "../recovery/timeout.js";

export async function waitForSelector(
  page: Page,
  selector: string,
  timeoutMs = 15_000,
): Promise<void> {
  await withTimeout(`waitForSelector(${selector})`, timeoutMs, () =>
    page.waitForSelector(selector, { visible: true, timeout: timeoutMs }),
  );
}

export async function clickSelector(page: Page, selector: string): Promise<void> {
  const el = await page.$(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  await el.click();
}

export async function typeIntoSelector(
  page: Page,
  selector: string,
  text: string,
  clearFirst = true,
): Promise<void> {
  await waitForSelector(page, selector);
  if (clearFirst) {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
  }
  await page.type(selector, text, { delay: 25 });
}

export async function pressKey(page: Page, key: KeyInput): Promise<void> {
  await page.keyboard.press(key);
}
