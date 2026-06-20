import { hideOverlay } from "../../windows/overlay.js";
import { runWhatsAppMessageFlow } from "../adapters/whatsapp/whatsappAdapter.js";
import {
  extractContactName,
  isWhatsAppMessagingCommand,
} from "../adapters/whatsapp/parseContact.js";
import { isContextualWhatsAppComposeCommand } from "../adapters/whatsapp/parseWhatsAppCommand.js";
import { replaceWhatsAppComposerViaExtension } from "../../bridge/nativeMessagingBridge.js";
import { restoreFocusContext } from "../../focus/focusContext.js";
import { getLastVoiceCommand } from "../../state/lastCommand.js";
import { smartInsertText } from "../smartInsert.js";

export async function runInsertText(data?: Record<string, unknown>): Promise<string> {
  const text = typeof data?.text === "string" ? data.text : "";
  hideOverlay();

  if (isContextualWhatsAppComposeCommand()) {
    const body = text.trim() || getLastVoiceCommand()?.trim() || "";
    if (!body) throw new Error("No message text for WhatsApp compose");
    console.info("[ripple-desktop] INSERT_TEXT → WhatsApp open-chat compose");
    await restoreFocusContext();
    await new Promise((r) => setTimeout(r, 400));
    return replaceWhatsAppComposerViaExtension(body);
  }

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
