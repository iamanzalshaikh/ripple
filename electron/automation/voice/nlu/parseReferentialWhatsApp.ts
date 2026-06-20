import { cleanContactName } from "../../adapters/whatsapp/parseContact.js";

export type ReferentialWhatsAppMode = "send_file" | "message_again";

/** @deprecated use ReferentialSendIntent */
export type ReferentialWhatsAppIntent = {
  kind: "referential_whatsapp";
  mode: ReferentialWhatsAppMode;
};

export type ReferentialSendIntent = {
  kind: "referential_send";
  contact: string;
  mode: ReferentialWhatsAppMode;
};

function pronounContact(cmd: string): string | null {
  if (/\b(?:her|him|them)\b/i.test(cmd)) {
    return "__last_contact__";
  }
  return null;
}

function extractNamedContact(cmd: string): string | null {
  const patterns = [
    /^\s*send\s+(?:it|that|this(?:\s+file)?)\s+to\s+(.+?)\s*$/i,
    /^\s*send\s+to\s+(.+?)\s*$/i,
    /^\s*share\s+(?:it|that|this(?:\s+file|folder)?)?\s+with\s+(.+?)\s*$/i,
    /^\s*whatsapp\s+(?:it|that|the\s+(?:file|folder))\s+to\s+(.+?)\s*$/i,
    /^\s*send\s+(?:the\s+)?(?:file|folder|pdf|photo)\s+to\s+(.+?)\s*$/i,
    /^\s*send\s+(?:that|the)\s+file\s+to\s+(.+?)\s*$/i,
    /^\s*(?:isko|use|ye|yeh)\s+(.+?)\s+ko\s+bhej(?:o| do)?\s*$/i,
    /^\s*(.+?)\s+ko\s+(?:isko|use|ye|yeh|the\s+file)\s+bhej(?:o| do)?\s*$/i,
    /^\s*(.+?)\s+ko\s+bhej(?:o| do)?\s*$/i,
  ];

  for (const re of patterns) {
    const m = cmd.match(re);
    if (m?.[1]?.trim()) {
      return cleanContactName(m[1]);
    }
  }
  return null;
}

/**
 * P2 — "send it to Noor", "share it with Dr. Fatima", pronoun contacts from memory.
 */
export function parseReferentialSend(
  command?: string | null,
): ReferentialSendIntent | null {
  const cmd = (command ?? "").trim();
  if (!cmd) return null;

  const lower = cmd.toLowerCase();

  if (
    /^\s*message\s+(?:her|him|them)\s+again\s*$/i.test(lower) ||
    /^\s*text\s+(?:her|him|them)\s+again\s*$/i.test(lower) ||
    /^\s*whatsapp\s+(?:her|him|them)\s+again\s*$/i.test(lower)
  ) {
    return {
      kind: "referential_send",
      contact: "__last_contact__",
      mode: "message_again",
    };
  }

  const named = extractNamedContact(cmd);
  if (named) {
    if (/^(?:her|him|them)$/i.test(named)) {
      return {
        kind: "referential_send",
        contact: "__last_contact__",
        mode: "send_file",
      };
    }
    return { kind: "referential_send", contact: named, mode: "send_file" };
  }

  if (
    /^\s*send\s+(?:her|him|them)\s+(?:the\s+)?(?:file|it)\s*$/i.test(lower) ||
    /^\s*send\s+(?:that|the)\s+file\s+to\s+(?:her|him|them)\s*$/i.test(lower) ||
    /^\s*send\s+it\s+to\s+(?:her|him|them)\s*$/i.test(lower) ||
    /^\s*(?:her|him|them)\s+ko\s+(?:the\s+)?file\s+send\s*$/i.test(lower) ||
    /^\s*send\s+(?:her|him)\s+(?:the\s+)?(?:resume|pdf|document)\s*$/i.test(lower)
  ) {
    return {
      kind: "referential_send",
      contact: "__last_contact__",
      mode: "send_file",
    };
  }

  return null;
}

/** Phase 4.6 — backward compat for pronoun-only WhatsApp phrases. */
export function parseReferentialWhatsApp(
  command?: string | null,
): ReferentialWhatsAppIntent | null {
  const send = parseReferentialSend(command);
  if (!send) return null;
  if (send.contact !== "__last_contact__") return null;
  return { kind: "referential_whatsapp", mode: send.mode };
}

export function resolveReferentialContact(
  contact: string,
  lastContact: string | null,
): string | null {
  if (contact === "__last_contact__") {
    return lastContact?.trim() || null;
  }
  return contact.trim() || null;
}
