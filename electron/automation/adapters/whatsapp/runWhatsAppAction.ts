import { openWhatsAppInBrowser } from "./openWhatsApp.js";
import { runWhatsAppMessageFlow } from "./whatsappAdapter.js";
import { getLastVoiceCommand } from "../../../state/lastCommand.js";
import { insertWhatsAppComposeText } from "./whatsappComposeInsert.js";

export async function runWhatsAppBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const kind = data?.whatsappKind;

  if (kind === "open") {
    return openWhatsAppInBrowser();
  }

  if (kind === "message") {
    const text = typeof data?.text === "string" ? data.text : "";
    const recipient = data?.recipient;
    const send = data?.send === true;
    return runWhatsAppMessageFlow({
      text,
      recipient: typeof recipient === "string" ? recipient : undefined,
      send,
      command:
        typeof data?.command === "string"
          ? data.command
          : (getLastVoiceCommand() ?? undefined),
    });
  }

  if (kind === "replace_composer" || kind === "compose_message") {
    const text = typeof data?.text === "string" ? data.text : "";
    return insertWhatsAppComposeText(text, {
      replaceAll: kind === "replace_composer",
    });
  }

  throw new Error(`Unknown WhatsApp action: ${String(kind)}`);
}
