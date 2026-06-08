/** WhatsApp Web — selectors may need updates when UI changes (Tier A maintenance). */
export const WA = {
  searchBox:
    '[aria-label="Search name or number"], [aria-label="Search input textbox"], [title="Search name or number"], div[contenteditable="true"][data-tab="3"], #side div[contenteditable="true"][role="textbox"]',
  chatInput:
    '[aria-label="Type a message"], #main div[contenteditable="true"][role="textbox"], footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"]',
  searchResult: 'div[role="listitem"], span[title]',
} as const;

export const WHATSAPP_WEB_URL = "https://web.whatsapp.com";
