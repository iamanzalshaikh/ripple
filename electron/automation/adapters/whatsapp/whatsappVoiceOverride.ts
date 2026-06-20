import { normalizeTranscript } from "../../voice/normalizeTranscript.js";
import {
  commandImpliesSend,
  extractContactName,
  isWhatsAppMessagingCommand,
  resolveWhatsAppMessageText,
} from "./parseContact.js";
import { rememberContact } from "./buildReferentialWhatsApp.js";
import type { CommandResultPayload, RippleAction } from "../../types.js";

/** Backend missed WhatsApp (low confidence → SHOW_SUGGESTIONS). Desktop runs it anyway. */
export function applyWhatsAppVoiceOverride(
  command: string,
  result: CommandResultPayload,
): CommandResultPayload | null {
  const cmd = normalizeTranscript(command);
  if (!isWhatsAppMessagingCommand(cmd)) return null;

  const contact = extractContactName(cmd);
  if (!contact?.trim()) return null;

  rememberContact(contact);

  const insertText =
    result.actions?.find((a) => a.type === "INSERT_TEXT")?.data?.text;
  const backendText = typeof insertText === "string" ? insertText : "";
  const message = resolveWhatsAppMessageText(cmd, backendText);

  const onlySuggestions =
    result.actions?.length === 1 &&
    result.actions[0]?.type === "SHOW_SUGGESTIONS";

  const notWorkflow =
    result.intent !== "workflow" ||
    !result.actions?.some((a) => a.type === "WORKFLOW");

  if (!onlySuggestions && !notWorkflow) return null;

  const workflowAction: RippleAction = {
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
            send: commandImpliesSend(cmd),
            command: cmd,
          },
        },
      ],
    },
  };

  console.info(
    `[ripple-desktop] WhatsApp voice override — contact="${contact}" (backend had intent=${result.intent})`,
  );

  return {
    ...result,
    intent: "workflow",
    actions: [workflowAction],
    output_type: "workflow",
  };
}
