import { isInstagramTabActive, isWhatsAppTabActive } from "../../../focus/focusContext.js";
import { isGmailVoiceCommand } from "../../commandIntent.js";
import {
  looksLikeBoxDrawingMojibake,
  repairCorruptedTranscript,
  repairCp437Utf8Mojibake,
} from "../../voice/i18n/repairEncoding.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";
import { getLastVoiceCommand } from "../../../state/lastCommand.js";

function isWhatsAppOpenOnly(cmd: string): boolean {
  return (
    /^\s*(?:open|launch|start)\s+whats?\s*app\s*\.?\s*$/i.test(cmd) ||
    /^\s*whats?\s*app\s+(?:open|kholo)\s*\.?\s*$/i.test(cmd)
  );
}

export function effectiveWhatsAppCommand(command?: string | null): string {
  let raw = normalizeTranscript(command ?? getLastVoiceCommand() ?? "");
  if (looksLikeBoxDrawingMojibake(raw)) {
    const cp437 = repairCp437Utf8Mojibake(raw);
    if (cp437 && !looksLikeBoxDrawingMojibake(cp437)) raw = cp437;
  }
  const repaired = repairCorruptedTranscript(raw);
  return repaired.length > 2 ? repaired : raw;
}

/** WhatsApp search uses Latin contact names — map Urdu/mojibake/demo aliases. */
export function resolveWhatsAppSearchName(raw: string): string {
  let name = cleanContactName(raw);
  if (!name) return name;
  if (looksLikeBoxDrawingMojibake(name)) {
    const fixed = repairCorruptedTranscript(repairCp437Utf8Mojibake(name));
    if (fixed && !looksLikeBoxDrawingMojibake(fixed)) {
      name = cleanContactName(fixed);
    }
  }
  if (/ڈاکٹر\s*فاطم/u.test(name)) return "Dr. Fatima";
  if (/^dr\.?\s*fatima$/i.test(name)) return "Dr. Fatima";
  if (/^doctor\s+fatima$/i.test(name)) return "Dr. Fatima";
  return name;
}

/** Marker for pronoun contacts resolved via session memory at execution time. */
export const LAST_CONTACT_MARKER = "__last_contact__";

const PRONOUN_CONTACT = /^(?:him|her|them|he|she)$/i;

const RELATIONAL_CONTACT =
  /^my\s+(?:brother|sister|mother|father|mom|dad|mum|bhai|behen|ammi|anna|akka|beta|beti)\b/i;

/** True when spoken name is a pronoun referring to last_contact memory. */
export function isPronounContact(name: string): boolean {
  return PRONOUN_CONTACT.test(name.trim());
}

/** True when contact is a relational phrase (my brother, my sister, …). */
export function isRelationalContact(name: string): boolean {
  return RELATIONAL_CONTACT.test(name.trim());
}

/** Resolve pronoun / __last_contact__ marker to a concrete contact name. */
export function resolveWhatsAppContactRef(
  contact: string,
  lastContact: string | null,
): string | null {
  const raw = contact.trim();
  if (!raw) return null;
  if (raw === LAST_CONTACT_MARKER || isPronounContact(raw)) {
    return lastContact?.trim() || null;
  }
  return raw;
}

function pronounMarker(contact: string): string {
  return isPronounContact(contact) ? LAST_CONTACT_MARKER : contact;
}

function finalizeContact(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  return resolveWhatsAppSearchName(name);
}

export function cleanContactName(raw: string): string {
  return raw
    .trim()
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .replace(/^to\s+/i, "")
    .replace(/^whatsapp\s+to\s+/i, "")
    .replace(/^to\s+whatsapp\s+to\s+/i, "")
    .replace(/\s+via\s+whatsapp$/i, "")
    .replace(/\s+on\s+whatsapp$/i, "")
    .replace(/\s+in\s+whatsapp$/i, "")
    .replace(/\s+on\s+whatsapp\b/gi, "")
    .replace(/\s+in\s+whatsapp\b/gi, "");
}

/** Urdu/Hinglish: "سرچ ڈاکٹر فاطمہ اور پوچھیں کہ..." */
function parseUrduSearchAndMessage(
  cmd: string,
): { message: string; contact: string } | null {
  const patterns = [
    /(?:سرچ|تلاش|ڈھونڈ)\s+(.+?)\s+(?:اور\s+)?(?:پوچھ|کہو|کہیں|بول|لکھ|سکہ)[^\s]*\s*(?:سکتے\s+ہیں\s+)?(?:کریں\s+)?(?:کہ\s+)?(.+)$/u,
    /(?:سرچ|تلاش|ڈھونڈ)\s+(ڈاکٹر\s*فاطم\w*)\s+(?:اور\s+).+$/u,
    /(?:سرچ|تلاش)\s+(.+?)\s+سکہ\s+(.+)$/u,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (!m?.[1]?.trim()) continue;
    const contact = finalizeContact(m[1]);
    if (!contact) continue;
    const message = m[2]?.trim() ?? "";
    if (message) {
      return { contact, message };
    }
    return { contact, message: "" };
  }
  return null;
}

/** "message Dr. Fatima asking how are you" → contact + message (not contact="Dr"). */
function parseMessageWithQualifier(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(
    /^\s*message\s+((?:(?:dr|doctor|mr|mrs|ms|prof)\.?\s+[A-Za-z][A-Za-z0-9'.-]+|[A-Za-z][A-Za-z0-9'.-]{2,50}?))\s+(?:and\s+)?(?:asking|saying|say|ask)\s*,?\s*(.+?)\.?\s*$/i,
  );
  if (!m?.[1]?.trim() || !m?.[2]?.trim()) return null;
  return {
    contact: finalizeContact(m[1])!,
    message: m[2].trim(),
  };
}

/** "Message Dr. Fatima and say, How are you" — title split across words. */
function parseMessageTitledNameAndSay(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(
    /^\s*message\s+((?:dr|doctor|mr|mrs|ms|prof)\.?)\s+([A-Za-z][A-Za-z0-9'.-]+)\s+(?:and\s+)?(?:say|ask|saying|asking)\s*,?\s*(.+?)\.?\s*$/i,
  );
  if (!m?.[1] || !m[2]?.trim() || !m[3]?.trim()) return null;
  return {
    contact: finalizeContact(`${m[1]} ${m[2]}`)!,
    message: m[3].trim(),
  };
}

/** "send hello to Dr. Fatima" → { message: "hello", contact: "Dr. Fatima" } */
function parseSendMessageToContact(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(/^\s*send\s+(.+?)\s+to\s+(.+?)\.?\s*$/i);
  if (!m?.[1]?.trim() || !m[2]?.trim()) return null;
  return {
    message: m[1].trim(),
    contact: finalizeContact(m[2])!,
  };
}

/**
 * "send [a] [whatsapp] message to <contact> saying/telling/that/: <message>"
 * Contact is everything up to the message separator (not up to first " to ").
 * Without a message body → open chat only (message: "").
 */
function parseSendWaMessageTo(
  cmd: string,
): { message: string; contact: string } | null {
  const withBody = cmd.match(
    /^\s*send\s+(?:a\s+)?(?:whats?\s*app\s+)?(?:message|msg|text)\s+to\s+(.+?)(?:\s+(?:saying|asking|telling|say|ask|tell|that)\s+|\s*:\s*)(.+?)\.?\s*$/i,
  );
  if (withBody?.[1]?.trim() && withBody[2]?.trim()) {
    return {
      contact: finalizeContact(withBody[1])!,
      message: withBody[2].trim(),
    };
  }
  const openOnly = cmd.match(
    /^\s*send\s+(?:a\s+)?(?:whats?\s*app\s+)?(?:message|msg|text)\s+to\s+(.+?)\.?\s*$/i,
  );
  if (openOnly?.[1]?.trim()) {
    return { contact: finalizeContact(openOnly[1])!, message: "" };
  }
  return null;
}

/** "send <contact>: <message>" — short form without "whatsapp message to". */
function parseSendContactColon(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(/^\s*send\s+(.+?)\s*:\s*(.+?)\.?\s*$/i);
  if (m?.[1]?.trim() && m[2]?.trim()) {
    return {
      contact: finalizeContact(m[1])!,
      message: m[2].trim(),
    };
  }
  return null;
}

/** "message my brother I reached home" — relational entity phrase as contact. */
function parseMessageRelational(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(
    /^\s*message\s+(my\s+(?:brother|sister|mother|father|mom|dad|mum|bhai|behen|ammi|anna|akka|beta|beti))\s+(.+?)\.?\s*$/i,
  );
  if (m?.[1]?.trim() && m[2]?.trim()) {
    return {
      contact: finalizeContact(m[1])!,
      message: m[2].trim(),
    };
  }
  return null;
}

/** "message Ammi 1 I will come tomorrow" — contact name includes a digit. */
function parseMessageNameWithDigit(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(
    /^\s*message\s+([A-Za-z][A-Za-z0-9'.-]*\s*\d+)\s+(.+?)\.?\s*$/i,
  );
  if (m?.[1]?.trim() && m[2]?.trim()) {
    return {
      contact: finalizeContact(m[1])!,
      message: m[2].trim(),
    };
  }
  return null;
}

/**
 * "message Ammi I will come tomorrow" — split when remainder looks like message
 * (starts with I/we/you/hello/good/the …), not a name continuation.
 */
function parseMessageContactMessageCue(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(
    /^\s*message\s+([A-Za-z][A-Za-z0-9'.\s(),-]*?)\s+((?:I\s|I'm|I am|I've|we\s|you\s|hello\b|hi\b|good\s|the\s|please\s).+?)\.?\s*$/i,
  );
  if (!m?.[1]?.trim() || !m[2]?.trim()) return null;
  const rawContact = m[1].trim();
  if (/^(?:dr|doctor|mr|mrs|ms|prof|my)\.?$/i.test(rawContact)) return null;
  return {
    contact: finalizeContact(rawContact)!,
    message: m[2].trim(),
  };
}

/** "message <contact>: <message>" — colon separates contact and body. */
function parseMessageContactColon(
  cmd: string,
): { message: string; contact: string } | null {
  const m = cmd.match(/^\s*(?:message|msg|text)\s+(.+?)\s*:\s*(.+?)\.?\s*$/i);
  if (m?.[1]?.trim() && m[2]?.trim()) {
    return { contact: finalizeContact(m[1])!, message: m[2].trim() };
  }
  return null;
}

/** "open [whatsapp] chat with <contact>" / "chat with <contact>" → open only. */
function parseChatWithContact(cmd: string): { contact: string } | null {
  const m = cmd.match(
    /\bchat\s+with\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)(?:\s+on\s+whats?\s*app)?\s*\.?\s*$/i,
  );
  if (m?.[1]?.trim()) return { contact: finalizeContact(m[1])! };
  return null;
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
  const raw = finalizeContact(m[1])!;
  return {
    contact: pronounMarker(raw),
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
  const rawContact = m[1].trim();
  if (/^(?:dr|doctor|mr|mrs|ms|prof)\.?$/i.test(rawContact)) return null;
  return {
    contact: finalizeContact(rawContact)!,
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
  return { contact: finalizeContact(`${m[1]} ${m[2]}`)! };
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
    return finalizeContact(dataRecipient);
  }

  const cmd = effectiveWhatsAppCommand(command);
  if (!cmd) return null;

  const searchOnWaOnly = cmd.match(
    /\bsearch\s+(.+?)\s+on\s+whatsapp\b/i,
  )?.[1];
  if (searchOnWaOnly?.trim()) {
    return finalizeContact(searchOnWaOnly);
  }

  const urdu = parseUrduSearchAndMessage(cmd);
  if (urdu?.contact) return urdu.contact;

  const waMsgTo = parseSendWaMessageTo(cmd);
  if (waMsgTo?.contact) return waMsgTo.contact;

  const sendColon = parseSendContactColon(cmd);
  if (sendColon?.contact) return sendColon.contact;

  const msgColon = parseMessageContactColon(cmd);
  if (msgColon?.contact) return msgColon.contact;

  const chatWith = parseChatWithContact(cmd);
  if (chatWith?.contact) return chatWith.contact;

  const sendTo = parseSendMessageToContact(cmd);
  if (sendTo?.contact) return sendTo.contact;

  const qualified = parseMessageWithQualifier(cmd);
  if (qualified?.contact) return qualified.contact;

  const titledAndSay = parseMessageTitledNameAndSay(cmd);
  if (titledAndSay?.contact) return titledAndSay.contact;

  const sendThen = parseSendContactThenMessage(cmd);
  if (sendThen?.contact) return sendThen.contact;

  const titledMessageOnly = parseMessageTitledNameOnly(cmd);
  if (titledMessageOnly?.contact) return titledMessageOnly.contact;

  const relational = parseMessageRelational(cmd);
  if (relational?.contact) return relational.contact;

  const nameDigit = parseMessageNameWithDigit(cmd);
  if (nameDigit?.contact) return nameDigit.contact;

  const messageCue = parseMessageContactMessageCue(cmd);
  if (messageCue?.contact) return messageCue.contact;

  const messageThen = parseMessageContactThenText(cmd);
  if (messageThen?.contact) return messageThen.contact;

  const messageOnly = cmd.match(
    /^\s*message\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\.?\s*$/i,
  )?.[1];
  if (messageOnly) return finalizeContact(messageOnly);

  const messageTo = cmd.match(
    /\bmessage\s+to\s+([A-Za-z][A-Za-z0-9'.\s-]{0,40}?)\s+(?:saying|say|ask)\b/i,
  )?.[1];
  if (messageTo) return finalizeContact(messageTo);

  const searchOnWaThenSay = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+on\s+whatsapp\s+and\s+(?:say|ask|tell|write)\b/i,
  )?.[1];
  if (searchOnWaThenSay) return finalizeContact(searchOnWaThenSay);

  const searchAndWrite = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+and\s+write\b/i,
  )?.[1];
  if (searchAndWrite) return finalizeContact(searchAndWrite);

  const searchThenSay = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+and\s+(?:say|ask|tell)\b/i,
  )?.[1];
  if (searchThenSay) return finalizeContact(searchThenSay);

  // "Search Dr. Fatima, say how are you" (comma instead of "and")
  const searchCommaThenSay = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s*,\s*(?:say|ask|tell)\b/i,
  )?.[1];
  if (searchCommaThenSay) return finalizeContact(searchCommaThenSay);

  const searchToken = cmd.match(
    /\bsearch\s+([A-Za-z0-9][A-Za-z0-9'.\s(),-]{0,50}?)\s+and\b/i,
  )?.[1];
  if (searchToken) return finalizeContact(searchToken);

  const patterns = [
    /\bfind\s+([A-Za-z][\w'.\s,-]{0,40}?)\s+(?:on\s+)?whatsapp\b/i,
    /\bopen\s+whatsapp\s+(?:and\s+)?search\s+([A-Za-z0-9][\w'.-]*)\s+and\b/i,
    /\b(?:whatsapp|message)\s+([A-Za-z][\w'-]{1,40})\s+(?:saying|hello|hi|that)\b/i,
    /\btext\s+([A-Za-z][\w'-]{1,40})\s+(?:on\s+)?whatsapp/i,
  ];

  for (const re of patterns) {
    const m = cmd.match(re);
    if (m?.[1]) {
      const name = finalizeContact(m[1]);
      if (name && name.length >= 1 && !/^to$/i.test(name)) return name;
    }
  }

  return null;
}

/** Send item from folder location to contact — desktop compound, not plain WA text. */
function isSendItemToContactPhrase(cmd: string): boolean {
  return /^\s*send\s+.+\s+(?:from|in)\s+(?:downloads?|documents?|desktop)\s+(?:to\s+whatsapp\s+)?to\s+/i.test(
    cmd,
  );
}

/** Dotted @-style handle in "Message xx.fx.66 and ask …" — route to Instagram, not WhatsApp. */
function looksLikeInstagramHandleTarget(cmd: string): boolean {
  const m = cmd.match(/^\s*message\s+(.+?)\s+and\s+(?:say|ask|tell)/i);
  if (!m?.[1]?.trim()) return false;
  const raw = m[1].trim();
  if (/^(?:dr|doctor|mr|mrs|ms|prof)\.?\s+/i.test(raw)) return false;
  const compact = raw.replace(/^underscope\s+/i, "").replace(/\s+/g, "");
  return (
    /^[A-Za-z0-9][A-Za-z0-9._]{1,29}$/.test(compact) && /[._]/.test(compact)
  );
}

/** Voice command looks like WhatsApp messaging. */
export function isWhatsAppMessagingCommand(command?: string | null): boolean {
  const cmd = effectiveWhatsAppCommand(command);
  if (!cmd) return false;
  if (isSendItemToContactPhrase(cmd)) return false;
  if (isGmailVoiceCommand(cmd)) return false;
  if (/\bnotion\b/i.test(cmd)) return false;
  if (/\byoutube\b/i.test(cmd)) return false;
  if (/\binstagram\b/i.test(cmd) || /\b(?:insta|ig)\b/i.test(cmd)) return false;
  if (/\bon\s+instagram\b/i.test(cmd)) return false;
  if (isInstagramTabActive()) return false;
  if (looksLikeInstagramHandleTarget(cmd) && !isWhatsAppTabActive()) return false;
  if (
    /(?:سرچ|تلاش|ڈھونڈ)\s+.+/u.test(cmd) &&
    /(?:پوچھ|کہو|کہیں|سکہ|بول|لکھ)/u.test(cmd)
  ) {
    return true;
  }
  if (/\bwhatsapp\b/i.test(cmd) && !isWhatsAppOpenOnly(cmd)) return true;
  if (/^\s*send\s+.+\s*:\s*\S/i.test(cmd)) return true;
  const contact = extractContactName(cmd);
  if (contact && !/\b(gmail|google\s*mail|mail|email)\b/i.test(cmd)) {
    return true;
  }
  if (
    /\b(search|find)\b/i.test(cmd) &&
    /\b(say|ask|tell|type|write|whatsapp)\b/i.test(cmd)
  ) {
    return true;
  }
  if (
    /\bmessage\s+(?!to\b)[A-Za-z]/i.test(cmd) &&
    /\b(say|ask|tell|saying)\b/i.test(cmd)
  ) {
    if (looksLikeInstagramHandleTarget(cmd) && !isWhatsAppTabActive()) return false;
    if (/^\s*message\s+(?:dr|doctor|mr|mrs|ms|prof)\.?\s+/i.test(cmd)) {
      return true;
    }
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
  const cmd = effectiveWhatsAppCommand(command);
  if (!cmd) return null;

  const urdu = parseUrduSearchAndMessage(cmd);
  if (urdu?.message) return urdu.message;

  const waMsgTo = parseSendWaMessageTo(cmd);
  if (waMsgTo) return waMsgTo.message.trim() ? waMsgTo.message.trim() : null;

  const sendColon = parseSendContactColon(cmd);
  if (sendColon?.message) return sendColon.message;

  const msgColon = parseMessageContactColon(cmd);
  if (msgColon?.message) return msgColon.message;

  const sendTo = parseSendMessageToContact(cmd);
  if (sendTo?.message) return sendTo.message;

  const qualified = parseMessageWithQualifier(cmd);
  if (qualified?.message) return qualified.message;

  const titledAndSay = parseMessageTitledNameAndSay(cmd);
  if (titledAndSay?.message) return titledAndSay.message;

  const sendThen = parseSendContactThenMessage(cmd);
  if (sendThen?.message) return sendThen.message;

  // "Message Dr. Fatima." is open-chat only (no message text).
  if (parseMessageTitledNameOnly(cmd)) return null;

  const relational = parseMessageRelational(cmd);
  if (relational?.message) return relational.message;

  const nameDigit = parseMessageNameWithDigit(cmd);
  if (nameDigit?.message) return nameDigit.message;

  const messageCue = parseMessageContactMessageCue(cmd);
  if (messageCue?.message) return messageCue.message;

  const messageThen = parseMessageContactThenText(cmd);
  if (messageThen?.message) return messageThen.message;

  const patterns = [
    /\bwrite\s+(?:a\s+)?message\s+to\s+(.+?)\.?$/i,
    /\band\s+write\s+(?:a\s+)?message\s+to\s+(.+?)\.?$/i,
    /\bmessage\s+to\s+[A-Za-z][\w'.-]*\s+saying\s+(.+)$/i,
    /\bsearch\s+.+?\s+and\s+(?:say|ask|tell|type|write)\s+(.+)$/i,
    /\band\s+(?:type|write)\s+(.+)$/i,
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
