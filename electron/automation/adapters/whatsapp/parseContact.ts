import { isInstagramTabActive } from "../../../focus/focusContext.js";
import { isGmailVoiceCommand } from "../../commandIntent.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";
import { getLastVoiceCommand } from "../../../state/lastCommand.js";

function cleanContactName(raw: string): string {
  return raw
    .trim()
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .replace(/^to\s+/i, "")
    .replace(/\s+on\s+whatsapp$/i, "")
    .replace(/\s+in\s+whatsapp$/i, "")
    .replace(/\s+on\s+whatsapp\b/gi, "")
    .replace(/\s+in\s+whatsapp\b/gi, "");
}

/** "send hello to Dr. Fatima" → { message: "hello", contact: "Dr. Fatima" } */
function parseSendMessageToContact(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(/^\s*send\s+(.+?)\s+to\s+(.+?)\.?\s*$/i);
  if (!m?.[1]?.trim() || !m[2]?.trim()) return null;
  return {
    message: m[1].trim(),
    contact: cleanContactName(m[2]),
  };
}

/** "send Noor good night" (no "to") → { contact: "Noor", message: "good night" } */
function parseSendContactThenMessage(
  cmd: string,
): { message: string; contact: string } | null {
  if (/\s+to\s+/i.test(cmd)) return null;
  const m = cmd.match(
    /^\s*send\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+(.+?)\.?\s*$/i,
  );
  if (!m?.[1]?.trim() || !m[2]?.trim()) return null;
  return {
    contact: cleanContactName(m[1]),
    message: m[2].trim(),
  };
}

/** "message Noor hello" → { contact: "Noor", message: "hello" } */
function parseMessageContactThenText(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(
    /^\s*message\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+(.+?)\.?\s*$/i,
  );
  if (!m?.[1]?.trim() || !m[2]?.trim()) return null;
  return {
    contact: cleanContactName(m[1]),
    message: m[2].trim(),
  };
}

/**
 * "Message Dr. Fatima." should open chat for "Dr. Fatima" (no message body).
 * Without this, it gets misread as contact="Dr" message="Fatima".
 */
function parseMessageTitledNameOnly(cmd: string): { contact: string } | null {
  const m = cmd.match(
    /^\s*message\s+((?:dr|doctor|mr|mrs|ms|prof)\.?)\s+([A-Za-z][A-Za-z0-9'.-]{0,60})\.?\s*$/i,
  );
  if (!m?.[1] || !m[2]) return null;
  return { contact: cleanContactName(`${m[1]} ${m[2]}`) };
}

/**
 * Extract contact name from commands like:
 * "search Ammi1 and say hi", "send hello to Dr. Fatima", "send Noor good night"
 */
export function extractContactName(
  command?: string | null,
  dataRecipient?: unknown,
): string | null {
  if (typeof dataRecipient === "string" && dataRecipient.trim()) {
    return cleanContactName(dataRecipient);
  }

  const cmd = normalizeTranscript(command ?? getLastVoiceCommand() ?? "");
  if (!cmd) return null;

  const sendTo = parseSendMessageToContact(cmd);
  if (sendTo?.contact) return sendTo.contact;

  const sendThen = parseSendContactThenMessage(cmd);
  if (sendThen?.contact) return sendThen.contact;

  const titledMessageOnly = parseMessageTitledNameOnly(cmd);
  if (titledMessageOnly?.contact) return titledMessageOnly.contact;

  const messageThen = parseMessageContactThenText(cmd);
  if (messageThen?.contact) return messageThen.contact;

  const messageOnly = cmd.match(
    /^\s*message\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\.?\s*$/i,
  )?.[1];
  if (messageOnly) return cleanContactName(messageOnly);

  const messageTo = cmd.match(
    /\bmessage\s+to\s+([A-Za-z][A-Za-z0-9'.\s-]{0,40}?)\s+(?:saying|say|ask)\b/i,
  )?.[1];
  if (messageTo) return cleanContactName(messageTo);

  const searchOnWaThenSay = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+on\s+whatsapp\s+and\s+(?:say|ask|tell|write)\b/i,
  )?.[1];
  if (searchOnWaThenSay) return cleanContactName(searchOnWaThenSay);

  const searchAndWrite = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+and\s+write\b/i,
  )?.[1];
  if (searchAndWrite) return cleanContactName(searchAndWrite);

  const searchThenSay = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+and\s+(?:say|ask|tell)\b/i,
  )?.[1];
  if (searchThenSay) return cleanContactName(searchThenSay);

  // "Search Dr. Fatima, say how are you" (comma instead of "and")
  const searchCommaThenSay = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s*,\s*(?:say|ask|tell)\b/i,
  )?.[1];
  if (searchCommaThenSay) return cleanContactName(searchCommaThenSay);

  const searchToken = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+and\b/i,
  )?.[1];
  if (searchToken) return cleanContactName(searchToken);

  const patterns = [
    /\bfind\s+([A-Za-z][\w'.\s,-]{0,40}?)\s+(?:on\s+)?whatsapp\b/i,
    /\bopen\s+whatsapp\s+(?:and\s+)?search\s+([A-Za-z0-9][\w'.-]*)\s+and\b/i,
    /\b(?:whatsapp|message)\s+([A-Za-z][\w'-]{1,40})\s+(?:saying|hello|hi|that)\b/i,
    /\btext\s+([A-Za-z][\w'-]{1,40})\s+(?:on\s+)?whatsapp/i,
  ];

  for (const re of patterns) {
    const m = cmd.match(re);
    if (m?.[1]) {
      const name = cleanContactName(m[1]);
      if (name.length >= 1 && !/^to$/i.test(name)) return name;
    }
  }

  return null;
}

/** Voice command looks like WhatsApp messaging. */
export function isWhatsAppMessagingCommand(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? getLastVoiceCommand() ?? "");
  if (!cmd) return false;
  if (isGmailVoiceCommand(cmd)) return false;
  if (/\bnotion\b/i.test(cmd)) return false;
  if (/\byoutube\b/i.test(cmd)) return false;
  if (/\binstagram\b/i.test(cmd) || /\b(?:insta|ig)\b/i.test(cmd)) return false;
  if (/\bon\s+instagram\b/i.test(cmd)) return false;
  if (isInstagramTabActive()) return false;
  if (/\bwhatsapp\b/i.test(cmd)) return true;
  const contact = extractContactName(cmd);
  if (contact && !/\b(gmail|google\s*mail|mail|email)\b/i.test(cmd)) {
    return true;
  }
  if (
    /\b(search|find)\b/i.test(cmd) &&
    /\b(say|ask|tell|whatsapp)\b/i.test(cmd)
  ) {
    return true;
  }
  if (
    /\bmessage\s+(?!to\b)[A-Za-z]/i.test(cmd) &&
    /\b(say|ask|tell|saying)\b/i.test(cmd)
  ) {
    return true;
  }
  return false;
}

/** True only when user says send/sent — "message" alone is draft-only. */
export function commandImpliesSend(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? getLastVoiceCommand() ?? "");
  if (!cmd) return false;
  if (/\b(don'?t|do not)\s+send\b/i.test(cmd)) return false;
  if (/^\s*send\s+/i.test(cmd)) return true;
  return /\b(send|sent)\b/i.test(cmd) && !/^\s*message\s+/i.test(cmd);
}

/** Text after "and say/ask" or "saying ..." — spoken words only, not AI body. */
export function extractMessageFromCommand(command?: string | null): string | null {
  const cmd = normalizeTranscript(command ?? getLastVoiceCommand() ?? "");
  if (!cmd) return null;

  const sendTo = parseSendMessageToContact(cmd);
  if (sendTo?.message) return sendTo.message;

  const sendThen = parseSendContactThenMessage(cmd);
  if (sendThen?.message) return sendThen.message;

  // "Message Dr. Fatima." is open-chat only (no message text).
  if (parseMessageTitledNameOnly(cmd)) return null;

  const messageThen = parseMessageContactThenText(cmd);
  if (messageThen?.message) return messageThen.message;

  const patterns = [
    /\bwrite\s+(?:a\s+)?message\s+to\s+(.+?)\.?$/i,
    /\band\s+write\s+(?:a\s+)?message\s+to\s+(.+?)\.?$/i,
    /\bmessage\s+to\s+[A-Za-z][\w'.-]*\s+saying\s+(.+)$/i,
    /\bsearch\s+.+?\s+and\s+(?:say|ask|tell)\s+(.+)$/i,
    /\b(?:say|ask)\s+(.+)$/i,
    /\bsaying\s+(.+)$/i,
  ];

  for (const re of patterns) {
    const m = cmd.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  return null;
}

/** Reject common backend AI bodies when the user did not say a message. */
function isAiGeneratedWhatsAppBody(text: string, contact: string): boolean {
  const t = text.trim().toLowerCase();
  const c = contact.trim().toLowerCase();
  if (/^how are you\b/i.test(t)) {
    if (!c || t.includes(c)) return true;
  }
  if (c && (t === `how are you, ${c}` || t === `how are you ${c}`)) return true;
  return false;
}

/**
 * Message body for WhatsApp: spoken words only (not backend INSERT_TEXT fillers).
 * Returns "" for "message Noor" (open chat only). Clipboard only when command mentions it.
 */
export function resolveWhatsAppMessageText(
  command?: string | null,
  backendText?: string | null,
): string {
  const cmd = normalizeTranscript(command ?? getLastVoiceCommand() ?? "");
  const voice = extractMessageFromCommand(cmd);
  if (voice !== null) return voice;

  if (/^\s*message\s+/i.test(cmd)) return "";

  if (/\bclipboard\b/i.test(cmd) && backendText?.trim()) {
    return backendText.trim();
  }

  const contact = extractContactName(cmd) ?? "";
  if (backendText?.trim() && isAiGeneratedWhatsAppBody(backendText, contact)) {
    return "";
  }

  return "";
}
