import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../../types.js";
import { rememberContact } from "./buildReferentialWhatsApp.js";
import { isSendItemToContactCommand } from "../../voice/nlu/compoundParse.js";
import {
  commandImpliesSend,
  extractContactName,
  isWhatsAppMessagingCommand,
  resolveWhatsAppMessageText,
} from "./parseContact.js";
import {
  isWhatsAppOpenCommand,
  parseWhatsAppCommand,
} from "./parseWhatsAppCommand.js";

/** Local WORKFLOW for WhatsApp — no backend OPEN_APP. */
export function buildWhatsAppCommandResult(
  command: string,
): CommandResultPayload | null {
  if (isSendItemToContactCommand(command)) {
    return null;
  }

  const intent = parseWhatsAppCommand(command);
  if (!intent) {
    if (isWhatsAppOpenCommand(command)) {
      return openOnlyPayload(command);
    }
    if (isWhatsAppMessagingCommand(command)) {
      return messagingPayload(command);
    }
    return null;
  }

  if (intent.kind === "open") {
    return openOnlyPayload(command);
  }

  if (intent.kind === "compose") {
    console.info(
      `[ripple-desktop] WhatsApp compose — open chat (${intent.text.length} chars) send=${intent.send}`,
    );
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
                type: "NOOP",
                status: "pending",
                data: {
                  _whatsappBatch: true,
                  whatsappKind: "compose_message",
                  text: intent.text,
                  send: intent.send,
                  command: command.trim(),
                },
              },
            ],
          },
        },
      ],
    };
  }

  rememberContact(intent.contact);
  console.info(
    `[ripple-desktop] WhatsApp command — message contact="${intent.contact}" send=${intent.send}`,
  );

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
                text: intent.text,
                recipient: intent.contact,
                send: intent.send,
                command: command.trim(),
                _whatsappBatch: true,
              },
            },
          ],
        },
      },
    ],
  };
}

function openOnlyPayload(command: string): CommandResultPayload {
  console.info("[ripple-desktop] WhatsApp command — open web.whatsapp.com");

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
              type: "NOOP",
              status: "pending",
              data: {
                _whatsappBatch: true,
                whatsappKind: "open",
                command: command.trim(),
              },
            },
          ],
        },
      },
    ],
  };
}

function messagingPayload(command: string): CommandResultPayload | null {
  const contact = extractContactName(command);
  if (!contact?.trim()) return null;

  rememberContact(contact);
  const message = resolveWhatsAppMessageText(command, "");
  const send = commandImpliesSend(command);

  console.info(
    `[ripple-desktop] WhatsApp command — message contact="${contact}" send=${send}`,
  );

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
                command: command.trim(),
                _whatsappBatch: true,
              },
            },
          ],
        },
      },
    ],
  };
}
