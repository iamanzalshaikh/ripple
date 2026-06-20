import type { NativeCommandIntent } from "../../desktop/parseNativeCommand.js";
import { parseNativeCommandStrict } from "../../desktop/parseNativeCommand.js";
import { parseNluFallback } from "./intentExtract.js";
import { preprocessForNlu } from "./preprocess.js";
import { cleanContactName } from "../../adapters/whatsapp/parseContact.js";
import { parseReferentialSend } from "./parseReferentialWhatsApp.js";
import type { ReferentialSendIntent } from "./parseReferentialWhatsApp.js";

export type CompoundIntent = {
  kind: "compound";
  steps: NativeCommandIntent[];
  label: string;
};

const COMPOUND_SPLIT =
  /\s+(?:and|aur|then|phir|plus|\+)\s+/i;

/** "Downloads kholo aur latest PDF open karo" → two parseable steps. */
export function splitCompoundParts(nlu: string): string[] | null {
  const trimmed = nlu.trim();
  if (!COMPOUND_SPLIT.test(trimmed)) return null;

  const parts = trimmed
    .split(COMPOUND_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);

  return parts.length >= 2 ? parts : null;
}

function normalizeCompoundPart(part: string): string {
  let p = part.trim();
  if (/^(downloads?|documents?|desktop)$/i.test(p)) {
    return `open ${p}`;
  }
  if (/^my\s+\w/i.test(p) && !/^open\b/i.test(p)) {
    return `open ${p}`;
  }
  if (/^search\s+/i.test(p)) {
    return p;
  }
  if (/^resume\b/i.test(p) || /^my\s+resume\b/i.test(p)) {
    return `open ${p}`;
  }
  if (/^send\b/i.test(p)) {
    p = p.replace(/\s+on\s+whatsapp\s*$/i, "").trim();
  }
  return p;
}

/** "Send latest resume to Noor" → open resume + referential send. */
export function parseSendResumeCompound(nlu: string): CompoundIntent | null {
  const m = nlu.match(
    /^\s*send\s+(?:the\s+)?(?:(?:latest|my)\s+)?(resume|pdf|document|file)\s+to\s+(.+?)\s*$/i,
  );
  if (!m?.[1]?.trim() || !m[2]?.trim()) return null;

  const tokenRaw = m[1].trim().toLowerCase();
  const token = tokenRaw === "file" ? "resume" : tokenRaw;
  const contact = cleanContactName(m[2]);
  if (!contact) return null;

  const searchStep: NativeCommandIntent =
    token === "resume"
      ? {
          kind: "smart_search",
          query: { type: "latest_token", token: "resume" },
          label: "my_resume",
        }
      : {
          kind: "smart_search",
          query: { type: "latest_token", token },
          label: `latest_${token}`,
        };

  const sendStep: ReferentialSendIntent = {
    kind: "referential_send",
    contact,
    mode: "send_file",
  };

  return {
    kind: "compound",
    steps: [searchStep, sendStep],
    label: `send ${token} to ${contact}`,
  };
}

function parentKey(raw: string): "downloads" | "documents" | "desktop" {
  const k = raw.trim().toLowerCase();
  if (k.startsWith("document")) return "documents";
  if (k.startsWith("download")) return "downloads";
  return "desktop";
}

function normalizeSendItemName(raw: string): string {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/\s+(?:folder|file|pdf|photo|image|video|screen\s*recording)\s*$/i, "")
    .trim();
  return stripped || trimmed;
}

/**
 * "Send Anzal folder from downloads to Dr. Fatima"
 * → open item + WhatsApp send with resolved path (not plain text).
 */
export function parseSendItemToContactCompound(
  nlu: string,
): CompoundIntent | null {
  const m = nlu.match(
    /^\s*send\s+(.+?)\s+(?:from|in)\s+(downloads?|documents?|desktop)\s+(?:to\s+whatsapp\s+)?to\s+(.+?)(?:\s+on\s+whatsapp)?\s*$/i,
  );
  if (!m?.[1]?.trim() || !m[2] || !m[3]?.trim()) return null;

  const name = normalizeSendItemName(m[1]);
  const parent = parentKey(m[2]);
  const contact = cleanContactName(m[3]);
  if (!contact || /^whatsapp$/i.test(contact)) return null;

  return {
    kind: "compound",
    steps: [
      { kind: "item", name, parent },
      { kind: "referential_send", contact, mode: "send_file" },
    ],
    label: `send ${name} to ${contact}`,
  };
}

/** True when desktop compound should open item then send — not plain WhatsApp text. */
export function isSendItemToContactCommand(command?: string | null): boolean {
  const trimmed = (command ?? "").trim();
  if (!trimmed) return false;
  const { nlu } = preprocessForNlu(trimmed);
  return parseSendItemToContactCompound(nlu) !== null;
}

/** "Open Anzal in downloads and send to Dr. Fatima" → open + referential send. */
export function parseOpenAndSendCompound(nlu: string): CompoundIntent | null {
  const m = nlu.match(
    /^\s*open\s+(?:my\s+|the\s+)?(.+?)\s+in\s+(downloads?|documents?|desktop)\s+and\s+send(?:\s+it|\s+that|\s+this)?\s+to\s+(.+?)(?:\s+on\s+whatsapp)?\s*$/i,
  );
  if (!m?.[1]?.trim() || !m[2] || !m[3]?.trim()) return null;

  const name = m[1].trim();
  const parent = m[2].toLowerCase().startsWith("document")
    ? "documents"
    : m[2].toLowerCase().startsWith("download")
      ? "downloads"
      : "desktop";
  const contact = cleanContactName(m[3]);
  if (!contact) return null;

  return {
    kind: "compound",
    steps: [
      { kind: "item", name, parent },
      {
        kind: "referential_send",
        contact,
        mode: "send_file",
      },
    ],
    label: `open ${name} + send to ${contact}`,
  };
}

export function parseCompoundIntent(nlu: string, raw?: string): CompoundIntent | null {
  const sendItem = parseSendItemToContactCompound(nlu);
  if (sendItem) {
    console.info(
      `[ripple-desktop] NLU compound → send item: ${sendItem.label}`,
    );
    return sendItem;
  }

  const openSend = parseOpenAndSendCompound(nlu);
  if (openSend) {
    console.info(
      `[ripple-desktop] NLU compound → open+send: ${openSend.label}`,
    );
    return openSend;
  }

  const sendCompound = parseSendResumeCompound(nlu);
  if (sendCompound) {
    console.info(
      `[ripple-desktop] NLU compound → send file plan: ${sendCompound.label}`,
    );
    return sendCompound;
  }

  const parts = splitCompoundParts(nlu);
  if (!parts) return null;

  const steps: NativeCommandIntent[] = [];
  for (const rawPart of parts) {
    const part = normalizeCompoundPart(rawPart);
    const referential = parseReferentialSend(part);
    if (referential) {
      steps.push(referential);
      continue;
    }
    const intent =
      parseNativeCommandStrict(part) ?? parseNluFallback(part, raw ?? part);
    if (!intent || intent.kind === "compound") return null;
    steps.push(intent);
  }

  console.info(
    `[ripple-desktop] NLU compound → ${steps.length} steps: ${steps.map((s) => s.kind).join(" → ")}`,
  );

  return {
    kind: "compound",
    steps,
    label: parts.join(" + "),
  };
}
