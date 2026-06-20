import { openUrlInBrowser } from "../../openUrl.js";

const WHATSAPP_URL = "https://web.whatsapp.com";

/** Open WhatsApp Web locally — no backend OPEN_APP. */
export async function openWhatsAppInBrowser(): Promise<string> {
  await openUrlInBrowser(WHATSAPP_URL);
  return "Opened WhatsApp";
}
