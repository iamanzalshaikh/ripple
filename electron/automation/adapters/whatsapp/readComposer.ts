import { queryWhatsAppComposerFromExtension } from "../../../bridge/nativeMessagingBridge.js";

/** Text already typed in the open WhatsApp message box. */
export async function readWhatsAppComposerText(): Promise<string | null> {
  try {
    return await queryWhatsAppComposerFromExtension();
  } catch {
    return null;
  }
}
