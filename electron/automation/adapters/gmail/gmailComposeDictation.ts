import { normalizeTranscript } from "../../voice/normalizeTranscript.js";
import { isGmailComposeFocused } from "../../../focus/focusContext.js";
import { isEditOrRephraseCommand, isNewEmailCommand } from "../../commandIntent.js";
import { looksLikeRippleOsCommand } from "../whatsapp/whatsappVoiceOverride.js";
import { prepareComposeDictationText } from "../../../agent/dictation/prepareComposeText.js";

/**
 * Plain speech while Gmail compose/draft is focused — type into the body
 * via the OS insert ladder (same Wispr path as WhatsApp open-chat).
 * Does not hijack explicit "write email to …" new-compose commands.
 */
export async function resolveGmailComposeDictationText(
  command: string,
): Promise<string | null> {
  if (!isGmailComposeFocused()) return null;
  const cmd = normalizeTranscript(command).trim();
  if (cmd.length < 2) return null;
  if (looksLikeRippleOsCommand(cmd)) return null;
  if (isNewEmailCommand(cmd)) return null;
  // Same fix as WhatsApp: an edit instruction on the drafted body must not be
  // typed here as literal new text — let it fall through to the backend-first
  // Gmail path (shouldRouteToBackendFirst already routes gmail compose there).
  if (isEditOrRephraseCommand(cmd)) return null;
  const prepared = await prepareComposeDictationText(cmd, { surface: "gmail" });
  return prepared.text.length >= 1 ? prepared.text : null;
}
