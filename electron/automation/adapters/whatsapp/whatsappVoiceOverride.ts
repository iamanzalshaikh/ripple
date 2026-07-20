import { normalizeTranscript } from "../../voice/normalizeTranscript.js";
import { isEditOrRephraseCommand } from "../../commandIntent.js";
import {
  commandImpliesSend,
  extractContactName,
  isWhatsAppMessagingCommand,
  resolveWhatsAppMessageText,
} from "./parseContact.js";
import { rememberContact } from "./buildReferentialWhatsApp.js";
import type { CommandResultPayload, RippleAction } from "../../types.js";
import { isWhatsAppTabActive } from "../../../focus/focusContext.js";
import { parseDesktopInputFallback } from "../../../agent/parseDesktopInput.js";
import { prepareComposeDictationText } from "../../../agent/dictation/prepareComposeText.js";

/** Clear Ripple/OS commands — never treat as chat dictation. */
export function looksLikeRippleOsCommand(cmd: string): boolean {
  if (parseDesktopInputFallback(cmd)) return true;
  return /^(?:open|close|launch|find|search|analyze|apply|fix|explain|run|typecheck|lint|scroll|click|select\s+all|paste|copy|undo|redo|minimize|maximize|switch\s+to|go\s+to)\b/i.test(
    cmd.trim(),
  );
}

function isWeakBackendResult(result: CommandResultPayload): boolean {
  if (!result.actions?.length) return true;
  if (result.actions.length !== 1) return false;
  const t = result.actions[0]?.type;
  return t === "SHOW_SUGGESTIONS" || t === "NOOP";
}

/**
 * Text to type into WhatsApp compose when the tab is focused and the utterance
 * is chat dictation (not a messaging workflow / Ripple OS command).
 * Applies P7.2 corrections + P7.4 memory + optional AI dictation_clean.
 */
export async function resolveWhatsAppComposeDictationText(
  command: string,
): Promise<string | null> {
  if (!isWhatsAppTabActive()) return null;
  const cmd = normalizeTranscript(command).trim();
  if (cmd.length < 2) return null;
  if (isWhatsAppMessagingCommand(cmd)) return null;
  if (looksLikeRippleOsCommand(cmd)) return null;
  // "Make this more confident" etc. is an edit instruction on text already in
  // the composer, not new dictation — let it fall through to the backend edit
  // / rephrase flow (shouldRouteToBackendFirst → applyWhatsAppRephraseOverride)
  // instead of being typed here as literal new message content.
  if (isEditOrRephraseCommand(cmd)) return null;
  const prepared = await prepareComposeDictationText(cmd, {
    surface: "whatsapp",
  });
  return prepared.text.length >= 1 ? prepared.text : null;
}

/**
 * When WhatsApp Web is focused and the user speaks chat text (not a Ripple
 * command / "message X that …" workflow), type into the compose box.
 * Fixes: conversational utterances becoming NOOP / web_search while the
 * message input already has keyboard focus.
 */
export async function applyWhatsAppComposeDictationOverride(
  command: string,
  result: CommandResultPayload,
): Promise<CommandResultPayload | null> {
  const cmd = await resolveWhatsAppComposeDictationText(command);
  if (!cmd) return null;
  if (!isWeakBackendResult(result)) return null;

  console.info(
    `[ripple-desktop] WhatsApp compose dictation — typing ${cmd.length} chars into focused chat`,
  );

  return {
    ...result,
    intent: "generation",
    actions: [
      {
        type: "INSERT_TEXT",
        status: "pending",
        data: { text: cmd },
      },
    ],
    output_type: "action",
  };
}

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
