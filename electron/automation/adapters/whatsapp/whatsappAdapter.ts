import { resolveTextWithClipboard } from "../../clipboard/clipboardService.js";
import { matchContactWithConfidence } from "../../contacts/contactMatch.js";
import { resolveContactWithUser } from "../../contacts/contactConfirmation.js";
import { getLastVoiceCommand } from "../../../state/lastCommand.js";
import {
  isExtensionBridgeConnectedAsync,
  runWhatsAppViaExtension,
} from "../../../bridge/whatsappExtensionBridge.js";
import {
  commandImpliesSend,
  extractContactName,
  resolveWhatsAppMessageText,
} from "./parseContact.js";
import { runWhatsAppCdpPipeline } from "./whatsappCdpPipeline.js";
import { WhatsAppPipelineError } from "./whatsappSteps.js";

export interface WhatsAppMessageInput {
  text: string;
  recipient?: string;
  command?: string;
  send?: boolean;
}

const USE_CDP = process.env.RIPPLE_USE_CDP === "1";

export async function runWhatsAppMessageFlow(
  input: WhatsAppMessageInput,
): Promise<string> {
  const rawContact = extractContactName(input.command, input.recipient);
  if (!rawContact) {
    throw new Error(
      'Contact name not found. Say e.g. "search Saaliq and say I will be back in 10 minutes"',
    );
  }

  const command = input.command ?? getLastVoiceCommand() ?? "";
  const text = resolveWhatsAppMessageText(command, input.text);
  const shouldSend = input.send ?? commandImpliesSend(command);

  if (!text.trim() && shouldSend) {
    throw new Error(
      'No message to send — say e.g. "send Noor good night" or "search Noor and say hello"',
    );
  }

  const match = matchContactWithConfidence(rawContact, {
    whatsAppSessionNames: [],
  });
  const contact = await resolveContactWithUser(match);
  if (!contact) {
    throw new Error("Contact not confirmed — cancelled");
  }

  const extensionOk = await isExtensionBridgeConnectedAsync();
  if (!USE_CDP && extensionOk) {
    console.info(
      `[ripple-desktop] WhatsApp via Native Messaging contact="${contact}"`,
    );
    console.info(
      `[ripple-desktop] WhatsApp payload contact="${contact}" send=${shouldSend} text="${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`,
    );
    return runWhatsAppViaExtension({
      contact,
      text,
      send: shouldSend,
    });
  }

  if (!USE_CDP) {
    throw new Error(
      "Ripple Native Messaging not connected. See WHATSAPP_SETUP.md — load extension, run install-windows.ps1, open web.whatsapp.com.",
    );
  }

  console.info(`[ripple-desktop] WhatsApp via CDP (dev) contact="${contact}"`);
  try {
    return await runWhatsAppCdpPipeline({
      contact,
      text,
      send: shouldSend,
      rawContact,
    });
  } catch (e: unknown) {
    if (e instanceof WhatsAppPipelineError) {
      throw new Error(`WhatsApp CDP failed at ${e.step}: ${e.message}`);
    }
    throw e;
  }
}
