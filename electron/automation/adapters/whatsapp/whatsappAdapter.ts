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
  LAST_CONTACT_MARKER,
  resolveWhatsAppContactRef,
  resolveWhatsAppMessageText,
} from "./parseContact.js";
import { rememberContact } from "./buildReferentialWhatsApp.js";
import { getLastCommandContext } from "../../../storage/lastCommandState.js";
import { recordWhatsAppSendTouch } from "../../../storage/recordFileTouch.js";
import { runWhatsAppCdpPipeline } from "./whatsappCdpPipeline.js";
import { WhatsAppPipelineError } from "./whatsappSteps.js";

import type { WhatsAppAttachmentPayload } from "./whatsappAttachment.js";

export interface WhatsAppMessageInput {
  text: string;
  recipient?: string;
  command?: string;
  send?: boolean;
  /** Resolved disk path when sending a file/folder from desktop session */
  sourcePath?: string;
  sourceKind?: string;
  attachment?: WhatsAppAttachmentPayload;
}

const USE_CDP = process.env.RIPPLE_USE_CDP === "1";

export async function runWhatsAppMessageFlow(
  input: WhatsAppMessageInput,
): Promise<string> {
  let rawContact = extractContactName(input.command, input.recipient);
  if (!rawContact) {
    throw new Error(
      'Contact name not found. Say e.g. "search Saaliq and say I will be back in 10 minutes"',
    );
  }

  const lastContact = getLastCommandContext().last_contact;
  const resolvedQuery =
    rawContact === LAST_CONTACT_MARKER
      ? resolveWhatsAppContactRef(LAST_CONTACT_MARKER, lastContact)
      : resolveWhatsAppContactRef(rawContact, lastContact);
  if (!resolvedQuery) {
    throw new Error(
      'No recent contact — open a chat first, then say e.g. "send him I am late"',
    );
  }
  rawContact = resolvedQuery;

  const command = input.command ?? getLastVoiceCommand() ?? "";
  const text =
    input.sourcePath?.trim() && input.text?.trim()
      ? input.text.trim()
      : resolveWhatsAppMessageText(command, input.text);
  const shouldSend = input.send ?? commandImpliesSend(command);

  if (!text.trim() && shouldSend && !input.attachment) {
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

  rememberContact(contact);

  const finishSend = (detail: string): string => {
    if (input.sourcePath?.trim() && shouldSend) {
      recordWhatsAppSendTouch({
        path: input.sourcePath.trim(),
        contact,
        command,
      });
    }
    return detail;
  };

  if (input.sourcePath) {
    console.info(
      `[ripple-desktop] WhatsApp send source: ${input.sourceKind ?? "item"} at ${input.sourcePath}`,
    );
  }
  if (input.attachment) {
    console.info(
      `[ripple-desktop] WhatsApp attachment: ${input.attachment.fileName} (${input.attachment.mimeType})`,
    );
  }

  const extensionOk = await isExtensionBridgeConnectedAsync();
  if (!USE_CDP && extensionOk) {
    console.info(
      `[ripple-desktop] WhatsApp via Native Messaging contact="${contact}"`,
    );
    const preview = input.attachment
      ? `file=${input.attachment.fileName}`
      : text.slice(0, 60) + (text.length > 60 ? "…" : "");
    console.info(
      `[ripple-desktop] WhatsApp payload contact="${contact}" send=${shouldSend} text="${preview}"`,
    );
    return finishSend(
      await runWhatsAppViaExtension({
        contact,
        text,
        send: shouldSend,
        attachment: input.attachment,
      }),
    );
  }

  if (!USE_CDP) {
    throw new Error(
      "Ripple Native Messaging not connected. See WHATSAPP_SETUP.md — load extension, run install-windows.ps1, open web.whatsapp.com.",
    );
  }

  console.info(`[ripple-desktop] WhatsApp via CDP (dev) contact="${contact}"`);
  try {
    return finishSend(
      await runWhatsAppCdpPipeline({
        contact,
        text,
        send: shouldSend,
        rawContact,
      }),
    );
  } catch (e: unknown) {
    if (e instanceof WhatsAppPipelineError) {
      throw new Error(`WhatsApp CDP failed at ${e.step}: ${e.message}`);
    }
    throw e;
  }
}
