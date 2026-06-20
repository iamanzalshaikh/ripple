import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../types.js";
import { getLastCommandContext, rememberContact } from "../../../storage/lastCommandState.js";
import {
  parseReferentialSend,
  resolveReferentialContact,
} from "../../voice/nlu/parseReferentialWhatsApp.js";
import { preprocessForNlu } from "../../voice/nlu/preprocess.js";
import { buildReferentialSendMessage } from "./executeReferentialSend.js";

/** Build WhatsApp workflow from session memory (last_contact + last_file). */
export function buildReferentialWhatsAppResult(
  command: string,
): CommandResultPayload | null {
  const { nlu } = preprocessForNlu(command);
  const intent = parseReferentialSend(nlu);
  if (!intent) return null;

  const ctx = getLastCommandContext();
  const contact = resolveReferentialContact(intent.contact, ctx.last_contact);
  if (!contact) {
    console.warn("[ripple-desktop] referential WhatsApp — no contact resolved");
    return null;
  }

  let message = "";
  let send = false;

  if (intent.mode === "send_file") {
    const filePath = ctx.last_file ?? ctx.last_folder;
    if (!filePath) {
      console.warn("[ripple-desktop] referential WhatsApp — no last_file/folder");
      return null;
    }
    message = buildReferentialSendMessage(filePath);
    send = true;
    rememberContact(contact);
    console.info(
      `[ripple-desktop] referential WhatsApp send_file → ${contact}`,
    );
  } else {
    rememberContact(contact);
    console.info(
      `[ripple-desktop] referential WhatsApp message_again → ${contact}`,
    );
  }

  return {
    command_id: randomUUID(),
    intent: "workflow",
    output_type: "workflow",
    actions: [
      {
        type: "WORKFLOW",
        status: "pending",
        data: {
          steps: [
            {
              type: "INSERT_TEXT",
              status: "pending",
              data: {
                text: message,
                recipient: contact,
                send,
                command: nlu,
                _whatsappBatch: true,
              },
            },
          ],
        },
      },
    ],
  };
}

export { rememberContact };
