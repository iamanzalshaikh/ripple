import { runWhatsAppMessageFlow } from "../../adapters/whatsapp/whatsappAdapter.js";
import { getLastVoiceCommand } from "../../../state/lastCommand.js";
import type { LocalAction } from "../../localTypes.js";
import { runWaitForWindow } from "./waitForWindow.js";

export async function runLocalAction(action: LocalAction): Promise<string> {
  switch (action.type) {
    case "WAIT_FOR_WINDOW":
      return runWaitForWindow(action.data);

    case "SEARCH_CONTACT":
    case "FOCUS_CHAT_INPUT":
      return "Handled by WhatsApp adapter batch";

    case "PRESS_ENTER":
      return "Handled by WhatsApp adapter send step";

    case "USE_CLIPBOARD_TEXT":
      return "Clipboard applied during INSERT_TEXT";

    case "OPEN_FOLDER":
    case "OPEN_FILE":
    case "LAUNCH_APP":
    case "FOCUS_APP":
    case "CLOSE_APP":
    case "MINIMIZE_ALL":
    case "SYSTEM_ACTION":
    case "RECALL_MEMORY":
    case "OPEN_ALIAS":
    case "REMEMBER_ALIAS":
    case "LIST_ALIASES":
    case "REMOVE_ALIAS":
    case "CREATE_FOLDER":
    case "CREATE_FILE":
    case "RENAME_FILE":
    case "MOVE_FILE":
    case "DELETE_FILE":
    case "OPEN_WORKSPACE":
    case "REMEMBER_WORKSPACE":
    case "RUN_WORKFLOW":
    case "REMEMBER_WORKFLOW":
    case "LIST_WORKFLOWS":
    case "REMOVE_WORKFLOW":
      return "Handled by desktop batch";

    default:
      throw new Error(`Unknown local action: ${String(action.type)}`);
  }
}

/** WhatsApp CDP batch triggered after OPEN_APP + context. */
export async function runWhatsAppLocalBatch(data?: Record<string, unknown>): Promise<string> {
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
