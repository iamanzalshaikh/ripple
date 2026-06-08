import {
  isInstagramFocused,
  isInstagramTabActive,
} from "../../../focus/focusContext.js";
import { isEditOrRephraseCommand } from "../../commandIntent.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";

export type InstagramIntent =
  | { kind: "open" }
  | { kind: "message"; username: string; text: string; send: boolean }
  | { kind: "compose"; text: string; send: boolean };

const OTHER_APPS =
  /\b(gmail|google\s*mail|whatsapp|notion|youtube|linkedin|slack|discord|spotify)\b/i;

const AI_FILLER =
  /\b(i'?m here to assist|how can i help you today|let me know if you need)\b/i;

function mentionsInstagram(cmd: string): boolean {
  return /\binstagram\b/i.test(cmd) || /\b(?:insta|ig)\b/i.test(cmd);
}

function mentionsOtherApps(cmd: string): boolean {
  return OTHER_APPS.test(cmd);
}

function onInstagramTab(): boolean {
  return isInstagramTabActive();
}

function cleanUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/^to\s+/i, "")
    .replace(/\s+on\s+instagram$/i, "")
    .replace(/\s+in\s+instagram$/i, "")
    .replace(/\s+and\s+send$/i, "")
    .replace(/[.,;]+$/, "")
    .replace(/\s{2,}/g, " ");
}

function commandImpliesSend(cmd: string): boolean {
  if (/\b(draft|don't\s+send|do\s+not\s+send)\b/i.test(cmd)) return false;
  return /\b(send|post)\b/i.test(cmd);
}

function isNavigationCommand(cmd: string): boolean {
  return (
    /^\s*open\s+/i.test(cmd) ||
    /\b(search|find|look\s+up|go\s+to)\b/i.test(cmd)
  );
}

function cleanMessageText(raw: string): string {
  return raw
    .trim()
    .replace(/^[,.\s]+/, "")
    .replace(/\s+on\s+instagram\s*$/i, "")
    .replace(/\s+and\s+send\s*$/i, "")
    .replace(/[.,;]+$/, "");
}

/** "Message Anzal saying hi and send on Instagram" */
function parseMessageSayingOnInstagram(
  cmd: string,
): { username: string; text: string } | null {
  const patterns = [
    /^\s*message\s+(.+?)\s+(?:saying|and\s+say|ask)\s*[,]?\s*(.+?)\s+on\s+instagram\s*$/i,
    /^\s*(?:dm|text)\s+(.+?)\s+(?:saying|and\s+say|ask)\s*[,]?\s*(.+?)\s+on\s+instagram\s*$/i,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (!m?.[1]?.trim() || !m[2]?.trim()) continue;
    return { username: cleanUsername(m[1]), text: cleanMessageText(m[2]) };
  }
  return null;
}

function parseMessageUserSaying(cmd: string): { username: string; text: string } | null {
  const m = cmd.match(
    /^\s*message\s+(.+?)\s+(?:saying|and\s+say|ask)\s*[,]?\s*(.+)$/i,
  );
  if (!m?.[1]?.trim() || !m[2]?.trim()) return null;
  return { username: cleanUsername(m[1]), text: cleanMessageText(m[2]) };
}

function parseSendTextToUser(cmd: string): { username: string; text: string } | null {
  const onIg = cmd.match(/^\s*send\s+(.+?)\s+to\s+(.+?)\s+on\s+instagram\s*$/i);
  if (onIg?.[1]?.trim() && onIg[2]?.trim()) {
    return {
      username: cleanUsername(onIg[2]),
      text: cleanMessageText(onIg[1]),
    };
  }
  const m = cmd.match(/^\s*send\s+(.+?)\s+to\s+([A-Za-z0-9][A-Za-z0-9'._\s-]{0,60})\s*$/i);
  if (!m?.[1]?.trim() || !m[2]?.trim()) return null;
  return { username: cleanUsername(m[2]), text: cleanMessageText(m[1]) };
}

function parseMessageUserOnInstagram(cmd: string): { username: string; text?: string } | null {
  const patterns = [
    /^\s*message\s+(.+?)\s+on\s+instagram(?:\s+(?:saying|and\s+say|ask)\s*(.+))?$/i,
    /^\s*(?:dm|text)\s+(.+?)\s+on\s+instagram(?:\s+(?:saying|and\s+say|ask)\s*(.+))?$/i,
    /^\s*instagram\s+message\s+(.+?)(?:\s+(?:saying|and\s+say|ask)\s*(.+))?$/i,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (!m?.[1]?.trim()) continue;
    const username = cleanUsername(m[1]);
    const text = m[2] ? cleanMessageText(m[2]) : undefined;
    return { username, text: text || undefined };
  }
  return null;
}

function parseSearchAndSay(cmd: string): { username: string; text: string } | null {
  const patterns = [
    /^\s*search\s+(.+?)\s+on\s+instagram\s+and\s+(?:say|ask|message|tell)\s+(.+)$/i,
    /^\s*search\s+(.+?)\s+on\s+instagram\s*,\s*(?:say|ask|message|tell)\s+(.+)$/i,
    /^\s*search\s+(.+?)\s+and\s+(?:say|ask|message|tell)\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (!m?.[1]?.trim() || !m[2]?.trim()) continue;
    return { username: cleanUsername(m[1]), text: cleanMessageText(m[2]) };
  }
  return null;
}

function parseStructuredMessage(cmd: string): { username: string; text: string } | null {
  const sayingOnIg = parseMessageSayingOnInstagram(cmd);
  if (sayingOnIg) return sayingOnIg;

  const saying = parseMessageUserSaying(cmd);
  if (saying?.username && saying.text) return saying;

  if (mentionsInstagram(cmd)) {
    const searchIg = parseSearchAndSay(cmd);
    if (searchIg) return searchIg;
    const sendIg = parseSendTextToUser(cmd);
    if (sendIg && /\bon\s+instagram\b/i.test(cmd)) return sendIg;
    const ig = parseMessageUserOnInstagram(cmd);
    if (ig?.username && ig.text) {
      return { username: ig.username, text: ig.text };
    }
  }

  return (
    parseSendTextToUser(cmd) ||
    parseSearchAndSay(cmd) ||
    (() => {
      const m = parseMessageUserOnInstagram(cmd);
      if (!m?.text) return null;
      return { username: m.username, text: m.text };
    })()
  );
}

/** Free-form DM text while an Instagram thread is open (no username in command). */
function looksLikeNamedMessage(cmd: string): boolean {
  if (/\bmake\s+it\s+(?:more\s+)?(?:emotional|confident|sad|angry|formal|casual)\b/i.test(cmd)) {
    return false;
  }
  return (
    /^\s*message\s+.+\s+(?:saying|and\s+say|ask)\b/i.test(cmd) ||
    /^\s*(?:send|dm|text)\s+.+/i.test(cmd) ||
    /^\s*search\s+.+\s+and\s+(?:say|ask|message|tell)\b/i.test(cmd)
  );
}

export function isContextualInstagramComposeCommand(
  command?: string | null,
): boolean {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd || !onInstagramTab() || mentionsOtherApps(cmd)) return false;
  if (isEditOrRephraseCommand(cmd)) return false;
  if (isNavigationCommand(cmd)) return false;
  if (looksLikeNamedMessage(cmd)) return false;
  if (parseStructuredMessage(cmd)) return false;
  if (mentionsInstagram(cmd) && /\bopen\b/i.test(cmd)) return false;
  return true;
}

export function isInstagramMessagingCommand(command?: string | null): boolean {
  const intent = parseInstagramCommand(command);
  return intent?.kind === "message" || intent?.kind === "compose";
}

/** Spoken words only — reject backend AI filler on Instagram DMs. */
export function resolveInstagramMessageText(
  command?: string | null,
  backendText?: string | null,
): string {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return "";

  const structured = parseStructuredMessage(cmd);
  if (structured?.text) return structured.text;

  if (isContextualInstagramComposeCommand(cmd)) {
    return cmd;
  }

  const backend = backendText?.trim() ?? "";
  if (backend && !AI_FILLER.test(backend)) {
    return backend;
  }

  return "";
}

/** Voice commands for Instagram (Tier C). */
export function parseInstagramCommand(command?: string | null): InstagramIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd || mentionsOtherApps(cmd)) return null;

  const onInstagram = isInstagramFocused() || onInstagramTab();
  const saidInstagram = mentionsInstagram(cmd);

  if (!saidInstagram && !onInstagram) return null;

  if (onInstagram && isEditOrRephraseCommand(cmd)) return null;

  if (
    (saidInstagram || onInstagram) &&
    /^\s*open\s+(?:the\s+)?(?:instagram|insta|ig)\s*$/i.test(cmd)
  ) {
    return { kind: "open" };
  }

  if (saidInstagram && /\bopen\b/i.test(cmd) && !/\b(message|dm|send|search)\b/i.test(cmd)) {
    return { kind: "open" };
  }

  const parsed = parseStructuredMessage(cmd);

  if (parsed && (saidInstagram || onInstagram || /\b(message|dm|send|search)\b/i.test(cmd))) {
    return {
      kind: "message",
      username: parsed.username,
      text: parsed.text,
      send: commandImpliesSend(cmd),
    };
  }

  if (isContextualInstagramComposeCommand(cmd)) {
    const text = resolveInstagramMessageText(cmd);
    if (!text.trim()) return null;
    return {
      kind: "compose",
      text,
      send: commandImpliesSend(cmd),
    };
  }

  return null;
}

export function isInstagramCommand(command?: string | null): boolean {
  return parseInstagramCommand(command) !== null;
}

export function isInstagramTypingBlocked(command?: string | null): boolean {
  if (!onInstagramTab()) return false;
  return isContextualInstagramComposeCommand(command);
}
