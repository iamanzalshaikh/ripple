import type { Page } from "puppeteer-core";

/**
 * Names visible in the current WhatsApp Web session only:
 * recent chats, sidebar titles — NOT the full phone contact database.
 */
export async function scrapeWhatsAppSessionNames(
  page: Page,
): Promise<string[]> {
  const names = await page.evaluate(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const nodes = document.querySelectorAll(
      '#pane-side span[title], #side span[title], [data-testid="cell-frame-title"] span[title]',
    );
    for (const el of nodes) {
      const t = el.getAttribute("title")?.trim();
      if (!t || t.length < 2) continue;
      if (/^\d+$/.test(t)) continue;
      const lower = t.toLowerCase();
      if (
        lower === "search input textbox" ||
        lower.includes("whatsapp") ||
        lower === "default-user"
      ) {
        continue;
      }
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(t);
    }
    return out;
  });

  console.info(
    `[ripple-desktop] WhatsApp session names (recent/searchable chats): ${names.length}`,
  );
  return names;
}
