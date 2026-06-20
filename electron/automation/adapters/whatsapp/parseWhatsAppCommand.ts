import { isWhatsAppTabActive } from "../../../focus/focusContext.js";
import { isEditOrRephraseCommand, isGmailVoiceCommand } from "../../commandIntent.js";
import {
  commandImpliesSend,
  effectiveWhatsAppCommand,
  extractContactName,
  isWhatsAppMessagingCommand,
  resolveWhatsAppMessageText,
} from "./parseContact.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";
import { looksLikeBoxDrawingMojibake } from "../../voice/i18n/repairEncoding.js";

export type WhatsAppCommandIntent =
  | { kind: "open" }
  | { kind: "message"; contact: string; text: string; send: boolean }
  | { kind: "compose"; text: string; send: boolean };

const OPEN_PATTERNS = [
  /^\s*open\s+whats?\s*app\s*\.?\s*$/i,
  /^\s*launch\s+whats?\s*app\s*\.?\s*$/i,
  /^\s*start\s+whats?\s*app\s*\.?\s*$/i,
  /^\s*whats?\s*app\s+open\s*\.?\s*$/i,
  /^\s*whats?\s*app\s+kholo\s*\.?\s*$/i,
];

function normalizedCommand(command: string): string {
  return effectiveWhatsAppCommand(command);
}

/** Structured contact/message — not "type into open chat". */
function looksLikeNamedWhatsAppMessage(cmd: string): boolean {
  if (/^\s*message\s+/i.test(cmd)) return true;
  if (/^\s*send\s+/i.test(cmd)) return true;
  if (
    /(?:سرچ|تلاش|ڈھونڈ)\s+.+/u.test(cmd) &&
    /(?:پوچھ|کہو|کہیں|سکہ|بول|لکھ)/u.test(cmd)
  ) {
    return true;
  }
  if (/\bsearch\s+.+\s+on\s+whatsapp\b/i.test(cmd)) return true;
  if (/\bsearch\s+.+\s+and\s+(?:say|ask|tell|write)\b/i.test(cmd)) return true;
  if (/\bsearch\s+.+\s*,\s*(?:say|ask|tell)\b/i.test(cmd)) return true;
  if (/\bfind\s+.+\b/i.test(cmd) && /\b(say|ask|tell|whatsapp)\b/i.test(cmd)) {
    return true;
  }
  return false;
}

/** Whisper often prefixes "Search" when the user only spoke message text in the composer. */
export function resolveContextualComposeText(command?: string | null): string {
  const cmd = effectiveWhatsAppCommand(command);
  const bare = cmd.match(/^\s*search\s+(.+)$/i);
  if (bare?.[1] && !/\band\s+(?:say|ask|tell|write)\b/i.test(cmd)) {
    return bare[1].trim();
  }
  return cmd.trim();
}

/**
 * Plain speech on an open WhatsApp chat — type into composer (no contact search).
 * Like Instagram DM compose: say your words directly while the message box is focused.
 */
export function isContextualWhatsAppComposeCommand(command?: string | null): boolean {
  const raw = normalizeTranscript(command ?? "");
  if (looksLikeBoxDrawingMojibake(raw)) return false;
  const cmd = effectiveWhatsAppCommand(command);
  if (!cmd || !isWhatsAppTabActive()) return false;
  if (isEditOrRephraseCommand(cmd)) return false;
  if (isGmailVoiceCommand(cmd)) return false;
  if (isWhatsAppOpenCommand(cmd)) return false;
  if (
    /^\s*(?:open|launch|start|close|switch\s+to|focus|minimize)\s+(?:the\s+)?/i.test(
      cmd,
    )
  ) {
    return false;
  }
  if (looksLikeNamedWhatsAppMessage(cmd)) return false;
  if (isWhatsAppMessagingCommand(cmd)) return false;
  if (/\b(youtube|linkedin|instagram|notion|gmail)\b/i.test(cmd)) return false;
  return resolveContextualComposeText(cmd).length >= 1;
}

/** "Open WhatsApp" / "WhatsApp kholo" — not messaging. */
export function isWhatsAppOpenCommand(command?: string | null): boolean {
  const cmd = normalizedCommand(command ?? "");
  if (!cmd) return false;
  if (!/\bwhats?\s*app\b/i.test(cmd)) return false;
  return OPEN_PATTERNS.some((re) => re.test(cmd));
}

export function parseWhatsAppCommand(
  command?: string | null,
): WhatsAppCommandIntent | null {
  const cmd = normalizedCommand(command ?? "");
  if (!cmd) return null;

  if (isWhatsAppOpenCommand(cmd)) {
    return { kind: "open" };
  }

  if (isWhatsAppMessagingCommand(cmd)) {
    const contact = extractContactName(cmd);
    if (!contact?.trim()) return null;
    return {
      kind: "message",
      contact,
      text: resolveWhatsAppMessageText(cmd, ""),
      send: commandImpliesSend(cmd),
    };
  }

  if (isContextualWhatsAppComposeCommand(cmd)) {
    const text = resolveContextualComposeText(cmd);
    if (!text) return null;
    return {
      kind: "compose",
      text,
      send: commandImpliesSend(cmd),
    };
  }

  return null;
}
