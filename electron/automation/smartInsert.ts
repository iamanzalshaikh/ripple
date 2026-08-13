import { clipboard } from "electron";
import {
  ensureInsertForeground,
  getFocusContext,
} from "../focus/focusContext.js";
import {
  ensureEditorKeyboardFocus,
  isClassicTextEditorProcess,
} from "../agent/editorFocus.js";
import { getLastVoiceCommand, isEditIntent } from "../state/lastCommand.js";
import { isWhatsAppMessagingCommand } from "./adapters/whatsapp/parseContact.js";
import { isContextualWhatsAppComposeCommand } from "./adapters/whatsapp/parseWhatsAppCommand.js";
import { resolveTextWithClipboard } from "./clipboard/clipboardService.js";
import { delay } from "./delay.js";
import { formatMessageBody } from "./emailFormat.js";
import {
  extractRecipientFromCommand,
  isAiGmailFillerBody,
  parseEmailContent,
  sanitizeEmailAddress,
  type ParsedEmail,
} from "./emailParse.js";
import { isAiNotionFillerBody } from "./adapters/notion/notionFiller.js";
import {
  isContextualNotionVoiceCommand,
  isNotionCommand,
  isNotionSamePageDocCommand,
} from "./adapters/notion/parseNotionCommand.js";
import {
  isContextualYouTubeVoiceCommand,
  isYouTubeCommand,
} from "./adapters/youtube/parseYouTubeCommand.js";
import {
  isContextualLinkedInVoiceCommand,
  isLinkedInCommand,
  isLinkedInTypingBlocked,
} from "./adapters/linkedin/parseLinkedInCommand.js";
import { isGoogleChatTabActive, isInstagramTabActive, isLinkedInTabActive, isWhatsAppTabActive } from "../focus/focusContext.js";
import { insertWhatsAppComposeText } from "./adapters/whatsapp/whatsappComposeInsert.js";
import { insertBrowserChatComposeText } from "./adapters/browser/browserChatComposeInsert.js";
import {
  isContextualInstagramComposeCommand,
  isInstagramTypingBlocked,
} from "./adapters/instagram/parseInstagramCommand.js";
import { composeInstagramMessage } from "./adapters/instagram/composeMessage.js";
import { insertInstagramComposeText } from "./adapters/instagram/instagramComposeInsert.js";
import {
  isEditOrRephraseCommand,
  isNewEmailCommand,
} from "./commandIntent.js";
import { openGmailCompose } from "./gmailComposeUrl.js";
import {
  pasteFromClipboard,
  selectAll,
} from "./keyboard.js";
import { runInsertWithFallback } from "./input/inputStrategy.js";
import { captureObservation } from "../agent/observe.js";
import { getInsertTextA11yDiagnostics } from "../native/win32Bridge.js";
import { pushUndoAction } from "./safety/undoStack.js";

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
  const cmd = getLastVoiceCommand() ?? "";
  return isWhatsAppTabActive() || isWhatsAppMessagingCommand(cmd);
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

  // Always open a new compose window — never type into inbox/search while on Gmail.
  return true;
}

function resolveGmailComposeFields(
  parsed: ParsedEmail,
  backendText: string,
): ParsedEmail {
  const to = parsed.to ? sanitizeEmailAddress(parsed.to) : undefined;
  let body = parsed.body;
  if (isAiGmailFillerBody(body) || isAiGmailFillerBody(backendText)) {
    body = "";
  }
  return { ...parsed, to, body };
}

/** Replace all text in the focused field (for edits). */
async function replaceTextInPlace(content: string): Promise<string> {
  const focus = getFocusContext();
  if (!(await ensureInsertForeground())) {
    throw new Error(
      "insert_aborted:ripple_foreground — click the target field and try again",
    );
  }
  await delay(450);
  if (!(await ensureInsertForeground())) {
    throw new Error(
      "insert_aborted:ripple_foreground — click the target field and try again",
    );
  }

  try {
    const diag = await getInsertTextA11yDiagnostics();
    const previousText = diag?.focused?.value?.trim();
    if (previousText) {
      pushUndoAction({
        kind: "restore_text_field",
        previousText,
        surface: focus?.processName,
      });
    }
  } catch {
    /* undo capture is best-effort */
  }

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
  const base = typeof data?.text === "string" ? data.text : rawText;
  const text = resolveTextWithClipboard(base);
  if (!text.trim()) {
    throw new Error("INSERT_TEXT missing text");
  }

  const voiceCommand = getLastVoiceCommand() ?? undefined;
  const parsed = parseEmailContent(text, { ...hints, command: voiceCommand });

  if (!parsed.to && voiceCommand) {
    parsed.to = extractRecipientFromCommand(voiceCommand);
  }
  if (parsed.to) {
    parsed.to = sanitizeEmailAddress(parsed.to);
  }
  const focus = getFocusContext();
  const cmd = voiceCommand ?? "";

  const notionVoice =
    isNotionCommand(cmd) ||
    (focus?.isNotion === true && isContextualNotionVoiceCommand(cmd));

  // For Notion docs generation, we want to paste into the current page (no notion.new).
  const isNotionDocWrite = isNotionSamePageDocCommand(cmd);

  if (notionVoice && !isNotionDocWrite && !isEditOrRephraseCommand(cmd)) {
    throw new Error(
      "Notion commands use notion.new + clipboard paste (3.5.1) — on a Notion tab say e.g. Create documentation for X and paste my clipboard",
    );
  }

  const youtubeVoice =
    isYouTubeCommand(cmd) ||
    (focus?.isYouTube === true && isContextualYouTubeVoiceCommand(cmd));

  if (youtubeVoice && !isEditOrRephraseCommand(cmd)) {
    throw new Error(
      "YouTube commands use search URL (B4) — say e.g. Search React tutorial on YouTube",
    );
  }

  const linkedinVoice =
    isLinkedInCommand(cmd) ||
    (isLinkedInTabActive() && isContextualLinkedInVoiceCommand(cmd));

  if ((linkedinVoice || isLinkedInTypingBlocked(cmd)) && !isEditOrRephraseCommand(cmd)) {
    throw new Error(
      "LinkedIn commands use the post composer (extension) — on a LinkedIn tab say e.g. Create post or Search Jasmine Pathan",
    );
  }

  const instagramCompose =
    isInstagramTabActive() && isContextualInstagramComposeCommand(cmd);

  const whatsappCompose =
    isWhatsAppTabActive() && isContextualWhatsAppComposeCommand(cmd);

  const googleChatCompose =
    isGoogleChatTabActive() && !isEditOrRephraseCommand(cmd);

  if (isInstagramTypingBlocked(cmd) && !isEditOrRephraseCommand(cmd)) {
    throw new Error(
      "Instagram DMs use the open chat composer — on an Instagram DM thread say your message directly",
    );
  }

  if (focus?.isNotion === true && isAiNotionFillerBody(text)) {
    throw new Error(
      "Blocked AI placeholder text on Notion — copy your content, then say paste clipboard on a Notion tab",
    );
  }

  if (whatsappCompose && !isEditOrRephraseCommand(cmd)) {
    console.info("[ripple-desktop] WA compose — type into open chat (OS-first)");
    const body = formatMessageBody(parsed, text.trim() || cmd.trim());
    return insertWhatsAppComposeText(body);
  }

  if (googleChatCompose) {
    console.info(
      "[ripple-desktop] Google Chat compose — type into open chat (OS-first)",
    );
    const body = formatMessageBody(parsed, text.trim() || cmd.trim());
    return insertBrowserChatComposeText(body);
  }

  if (instagramCompose && !isEditOrRephraseCommand(cmd)) {
    console.info("[ripple-desktop] IG compose — type into open chat (OS-first)");
    const body = formatMessageBody(parsed, text.trim() || cmd.trim());
    return insertInstagramComposeText(body);
  }

  if (
    (isEditOrRephraseCommand(cmd) || isEditIntent()) &&
    !instagramCompose
  ) {
    const formatted = formatMessageBody(parsed, text);
    if (isInstagramTabActive()) {
      console.info("[ripple-desktop] DM rephrase — replace in composer");
      return composeInstagramMessage({
        text: formatted,
        send: false,
        replaceAll: true,
      });
    }
    if (isWhatsAppTabActive()) {
      console.info(
        "[ripple-desktop] WA rephrase — replace in composer (OS-first)",
      );
      return insertWhatsAppComposeText(formatted, { replaceAll: true });
    }
    console.info("[ripple-desktop] edit/rephrase — replace in place (no new Gmail window)");
    return replaceTextInPlace(formatted);
  }

  if (shouldUseGmailCompose(parsed, text)) {
    const compose = resolveGmailComposeFields(parsed, text);
    if (!compose.to) {
      console.warn(
        `[ripple-desktop] No recipient in command — say "write mail to name@gmail.com"`,
      );
    }
    try {
      console.info(
        `[ripple-desktop] Gmail compose URL (new window) — to=${compose.to ?? "(empty)"} subject="${(compose.subject ?? "").slice(0, 50)}" body=${compose.body.length}ch`,
      );
      return await openGmailCompose(compose);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ripple-desktop] Gmail compose URL failed: ${msg}`);
      throw new Error(
        `Could not open new Gmail compose. ${msg}`,
      );
    }
  }

  if (!(await ensureInsertForeground())) {
    throw new Error(
      "insert_aborted:ripple_foreground — click the target field and try again",
    );
  }
  await delay(isWhatsAppContext() ? 550 : 400);

  if (focus && isClassicTextEditorProcess(focus.processName)) {
    await ensureEditorKeyboardFocus();
    await delay(200);
  }

  const insertBody = isWhatsAppContext()
    ? formatMessageBody(parsed, text)
    : parsed.body || text;

  try {
    const beforeObserve = await captureObservation();
    // Browser composers (esp. WhatsApp Web) often report native_text ok=false
    // after the text already landed. Falling through to sendkeys retypes the
    // full string (live double message). Prefer clipboard + abort on native fail.
    const browserComposer = Boolean(focus?.isBrowser) || isWhatsAppContext();
    const { detail } = await runInsertWithFallback(insertBody, {
      verify: process.env.RIPPLE_P85_INSERT_VERIFY !== "0",
      beforeObserve,
      preferFirst: browserComposer ? "clipboard_paste" : undefined,
      abortLadderOnPartialNativeFail: browserComposer,
      acceptUnverifiableEdit: browserComposer,
      includeVision: !browserComposer,
    });
    return detail;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[ripple-desktop] insert ladder exhausted:", msg);
    // Ladder strategies already SendKeys/pasted before failing verify. A second
    // clipboard paste here was the production double-write (HelloHello / Search).
    if (
      /insert_aborted|foreground_changed|native_text_partial|refusing|duplicate/i.test(
        msg,
      )
    ) {
      throw e instanceof Error ? e : new Error(msg);
    }
    clipboard.writeText(insertBody);
    await delay(120);
    try {
      await pasteFromClipboard();
      return focus
        ? `Pasted ${insertBody.length} chars into ${focus.processName} (fallback)`
        : `Pasted ${insertBody.length} characters (fallback)`;
    } catch {
      return `Copied to clipboard (${insertBody.length} chars) — press Ctrl+V`;
    }
  }
}
