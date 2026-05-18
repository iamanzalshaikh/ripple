import { clipboard } from "electron";
import { getFocusContext, restoreFocusContext } from "../focus/focusContext.js";
import { getLastVoiceCommand, isEditIntent } from "../state/lastCommand.js";
import { delay } from "./delay.js";
import { formatMessageBody } from "./emailFormat.js";
import {
  extractRecipientFromCommand,
  parseEmailContent,
  type ParsedEmail,
} from "./emailParse.js";
import {
  isEditOrRephraseCommand,
  isNewEmailCommand,
} from "./commandIntent.js";
import { fillGmailComposeKeyboard } from "./gmailFill.js";
import { openGmailCompose } from "./gmailComposeUrl.js";
import {
  pasteFromClipboard,
  selectAll,
  simulateTyping,
} from "./keyboard.js";

const TYPING_MAX = 280;

function hintsFromData(data?: Record<string, unknown>): Partial<ParsedEmail> {
  const to =
    typeof data?.recipient === "string"
      ? data.recipient
      : typeof data?.to === "string"
        ? data.to
        : undefined;
  const subject = typeof data?.subject === "string" ? data.subject : undefined;
  const body =
    typeof data?.body === "string"
      ? data.body
      : typeof data?.text === "string"
        ? data.text
        : undefined;
  return { to, subject, body };
}

function isWhatsAppContext(): boolean {
  const focus = getFocusContext();
  const cmd = getLastVoiceCommand() ?? "";
  return focus?.isWhatsApp === true || /\bwhatsapp\b/i.test(cmd);
}


function shouldUseGmailCompose(parsed: ParsedEmail, rawText: string): boolean {
  if (isWhatsAppContext()) return false;

  const cmd = getLastVoiceCommand() ?? "";

  // Edit / rephrase / tone — always replace text in the current field (Phase 3 in-place).
  if (isEditOrRephraseCommand(cmd)) {
    return false;
  }

  // Gmail compose URL only for explicit "write new email" commands.
  if (!isNewEmailCommand(cmd)) {
    return false;
  }

  return Boolean(parsed.subject || parsed.body.length > 40 || parsed.to);
}

/** Replace all text in the focused field (for edits). */
async function replaceTextInPlace(content: string): Promise<string> {
  const focus = getFocusContext();
  await restoreFocusContext();
  await delay(450);

  clipboard.writeText(content);
  await delay(80);
  await selectAll();
  await delay(60);
  await pasteFromClipboard();

  return focus
    ? `Updated text in ${focus.processName} (${content.length} chars)`
    : `Updated text (${content.length} chars)`;
}

/**
 * Gmail: open pre-filled compose URL (primary).
 * Other apps: restore focus → type → paste fallback.
 */
export async function smartInsertText(
  rawText: string,
  data?: Record<string, unknown>,
): Promise<string> {
  const hints = hintsFromData(data);
  const text = typeof data?.text === "string" ? data.text : rawText;
  if (!text.trim()) {
    throw new Error("INSERT_TEXT missing text");
  }

  const voiceCommand = getLastVoiceCommand() ?? undefined;
  const parsed = parseEmailContent(text, { ...hints, command: voiceCommand });

  if (!parsed.to && voiceCommand) {
    parsed.to = extractRecipientFromCommand(voiceCommand);
  }
  if (parsed.to) {
    parsed.to = parsed.to.toLowerCase().replace(/\s+/g, "");
  }
  const focus = getFocusContext();
  const cmd = voiceCommand ?? "";

  if (isEditOrRephraseCommand(cmd) || isEditIntent()) {
    console.info("[ripple-desktop] edit/rephrase — replace in place (no new Gmail window)");
    const formatted = formatMessageBody(parsed, text);
    return replaceTextInPlace(formatted);
  }

  if (shouldUseGmailCompose(parsed, text)) {
    if (!parsed.to) {
      console.warn(
        `[ripple-desktop] No recipient in command — say "write mail to name@gmail.com"`,
      );
    }
    try {
      console.info(
        `[ripple-desktop] Gmail compose URL — to=${parsed.to ?? "(empty — add email in command)"} subject="${(parsed.subject ?? "").slice(0, 50)}" body=${parsed.body.length}ch`,
      );
      return await openGmailCompose(parsed);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ripple-desktop] Gmail compose URL failed: ${msg}`);
      if (focus?.isGmail) {
        try {
          return await fillGmailComposeKeyboard(parsed, "body");
        } catch (e2: unknown) {
          throw new Error(
            `Gmail fill failed. Restart Ripple (tray → quit, npm run dev). ${e2 instanceof Error ? e2.message : e2}`,
          );
        }
      }
      throw new Error(
        `Could not open Gmail compose. Fully quit Ripple and run npm run dev again. ${msg}`,
      );
    }
  }

  await restoreFocusContext();
  await delay(isWhatsAppContext() ? 550 : 400);

  const insertBody = isWhatsAppContext()
    ? formatMessageBody(parsed, text)
    : parsed.body || text;

  if (insertBody.length <= TYPING_MAX) {
    try {
      await simulateTyping(insertBody);
      return `Typed ${insertBody.length} characters`;
    } catch (e: unknown) {
      console.warn(
        "[ripple-desktop] simulateTyping failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  clipboard.writeText(insertBody);
  await delay(120);
  try {
    await pasteFromClipboard();
    return focus
      ? `Pasted ${insertBody.length} chars into ${focus.processName}`
      : `Pasted ${insertBody.length} characters`;
  } catch {
    return `Copied to clipboard (${insertBody.length} chars) — press Ctrl+V`;
  }
}
