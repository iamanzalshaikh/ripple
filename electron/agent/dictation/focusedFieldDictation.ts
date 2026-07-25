import { normalizeTranscript } from "../../automation/voice/normalizeTranscript.js";
import { isEditOrRephraseCommand } from "../../automation/commandIntent.js";
import { looksLikeRippleOsCommand } from "../../automation/adapters/whatsapp/whatsappVoiceOverride.js";
import {
  getFocusContext,
  isGmailComposeFocused,
  isInstagramTabActive,
  isRippleApplicationWindow,
  isWhatsAppTabActive,
} from "../../focus/focusContext.js";
import { isEditableFocused } from "../planner/executionSync.js";
import { prepareComposeDictationText } from "./prepareComposeText.js";
import { getActiveNoteId } from "../../state/activeNoteFocus.js";

/**
 * Generic focused-field dictation — same INSERT_TEXT path WhatsApp/Gmail use,
 * for any editable surface (Notepad, Cursor, Word, browser inputs, …).
 *
 * WA/Gmail/Instagram keep their dedicated resolvers (messaging / new-email /
 * DM-compose guards). This covers everything else so chatty speech is typed,
 * not planned → CLARIFY.
 *
 * Instagram was missing from this list until this fix: plain DM dictation
 * (no contact name, no "message X" structure) fell through to this generic
 * path, got typed via the generic insert call, and was then rejected by
 * smartInsert.ts's Instagram guard — which exists specifically to defer to
 * instagramVoiceOverride.ts, the dedicated path that never got a chance to
 * run. Net effect: every plain-content Instagram DM dictation failed with
 * "Instagram DMs use the open chat composer — say your message directly"
 * even while already on the DM thread saying the message directly.
 *
 * P10.1 — Ripple's own windows are excluded below by default (dictating
 * into your own settings UI makes no sense), *except* the Notes editor with
 * a note actively open: that's a legitimate dictation target ("dictate into
 * a note"), reported by the renderer via notes:setActiveNote on focus/blur.
 */
export async function resolveFocusedFieldDictationText(
  command: string,
): Promise<string | null> {
  const activeNoteId = getActiveNoteId();

  // P10.1 — an open Ripple note always wins over sticky WhatsApp/Gmail/IG.
  // Flow Bar focus makes isWhatsAppTabActive() stay true from an earlier chat;
  // without this gate, note dictation was pasted into WhatsApp (live log).
  if (!activeNoteId) {
    if (isWhatsAppTabActive()) return null;
    if (isGmailComposeFocused()) return null;
    if (isInstagramTabActive()) return null;
  }

  const focus = getFocusContext();
  const isRippleWindow =
    focus != null &&
    isRippleApplicationWindow(focus.processName ?? "", focus.windowTitle ?? "");
  if (isRippleWindow && !activeNoteId) {
    return null;
  }

  // Note dictation: Flow Bar steals editable focus mid-utterance — still allow.
  if (!activeNoteId && !(await isEditableFocused())) return null;

  const cmd = normalizeTranscript(command).trim();
  if (cmd.length < 2) return null;
  if (looksLikeRippleOsCommand(cmd)) return null;
  if (isEditOrRephraseCommand(cmd)) return null;

  const prepared = await prepareComposeDictationText(cmd, {
    surface: "focused-field",
  });
  return prepared.text.length >= 1 ? prepared.text : null;
}


