import { hideOverlay } from "../../windows/overlay.js";
import { runWhatsAppMessageFlow } from "../adapters/whatsapp/whatsappAdapter.js";
import {
  extractContactName,
  isWhatsAppMessagingCommand,
} from "../adapters/whatsapp/parseContact.js";
import { smartInsertText } from "../smartInsert.js";

export async function runInsertText(data?: Record<string, unknown>): Promise<string> {
  const text = typeof data?.text === "string" ? data.text : "";
  hideOverlay();

  if (isWhatsAppMessagingCommand() && extractContactName()) {
    console.info("[ripple-desktop] INSERT_TEXT → WhatsApp CDP (contact in command)");
    return runWhatsAppMessageFlow({
      text,
      recipient:
        (typeof data?.recipient === "string" ? data.recipient : null) ??
        extractContactName() ??
        undefined,
    });
  }

  return smartInsertText(text, data);
}
