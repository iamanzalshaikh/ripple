import { isLinkedInTabActive } from "../../../focus/focusContext.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";

export type LinkedInIntent =
  | { kind: "open" }
  | { kind: "search_people"; query: string }
  | { kind: "create_post"; text?: string; publish: boolean };

const OTHER_APPS =
  /\b(gmail|google\s*mail|whatsapp|notion|youtube|instagram|slack|discord|spotify)\b/i;

function mentionsLinkedIn(cmd: string): boolean {
  return (
    /\blinkedin\b/i.test(cmd) ||
    /(?:لنکڈن|لنگڈین|لنک\s*ڈن)/u.test(cmd)
  );
}

function sanitizePeopleQuery(raw: string): string {
  return raw
    .replace(/^(?:سرچ|تلاش|ڈھونڈ|کھوج)\s+/u, "")
    .replace(/\s+(?:لنکڈن|لنگڈین|لنک\s*ڈن|linkedin)\s*$/iu, "")
    .replace(/\s+(?:ہون|پر|on)\s*$/iu, "")
    .trim();
}

function mentionsOtherApps(cmd: string): boolean {
  return OTHER_APPS.test(cmd);
}

function onLinkedInTab(): boolean {
  return isLinkedInTabActive();
}

function wantsPublish(cmd: string): boolean {
  if (/\b(draft|don't\s+post|do\s+not\s+post|without\s+posting)\b/i.test(cmd)) {
    return false;
  }
  return /\b(publish|post\s+it|share\s+it|post\s+now)\b/i.test(cmd);
}

function extractPostText(cmd: string): string | undefined {
  const patterns = [
    /\b(?:post|draft)\s+saying\s+(.+)$/i,
    /\b(?:saying|that\s+says|with\s+text)\s+(.+)$/i,
    /\bpost\s*:\s*(.+)$/i,
    /\bdraft\s*:\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    const t = m?.[1]?.trim().replace(/[.,;]+$/, "");
    if (t && t.length >= 2) return t.slice(0, 3000);
  }
  return undefined;
}

function extractPostTopic(cmd: string): string | undefined {
  const patterns = [
    /\b(?:about|on|regarding)\s+(.+)$/i,
    /\bpost\s+(?:on|about)\s+(.+)$/i,
    /\bcreate\s+(?:a\s+)?(?:linkedin\s+)?post\s+(?:about|on)\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    const t = m?.[1]?.trim().replace(/[.,;]+$/, "");
    if (t && t.length >= 2 && !/^(linkedin|a\s+post)$/i.test(t)) {
      return t.slice(0, 500);
    }
  }
  return undefined;
}

export function wantsCreatePost(cmd: string): boolean {
  if (/^\s*(?:create|start|new)\s+(?:a\s+)?post\s*$/i.test(cmd)) return true;
  return (
    /\b(create|draft|write|make|start|new)\b/i.test(cmd) &&
    /\b(post|update|article)\b/i.test(cmd)
  );
}

function wantsSearch(cmd: string): boolean {
  return (
    /\b(search|find|look\s+up)\b/i.test(cmd) ||
    /(?:سرچ|تلاش|ڈھونڈ|کھوج)/u.test(cmd)
  );
}

function wantsSearchPeople(cmd: string): boolean {
  return wantsSearch(cmd) && /\b(people|person|contact|profile)\b/i.test(cmd);
}

function extractPeopleQuery(cmd: string): string | undefined {
  const patterns = [
    /\bsearch\s+(?:for\s+)?(?:people\s+)?(?:named\s+)?(.+?)\s+on\s+linkedin/i,
    /\bfind\s+(.+?)\s+on\s+linkedin/i,
    /\bsearch\s+linkedin\s+(?:for\s+)?(?:people\s+)?(.+)$/i,
    /(?:سرچ|تلاش)\s+(?:کے\s+لیے\s+)?(.+?)\s+(?:پر\s+)?(?:لنکڈن|لنگڈین|لنک\s*ڈن)/u,
    /(?:سرچ|تلاش)\s+(.+?)\s+(?:لنکڈن|لنگڈین|لنک\s*ڈن|ہون)/u,
    /\bsearch\s+(?:for\s+)?(?:people\s+)?(?:named\s+)?(.+)$/i,
    /\bfind\s+(.+)$/i,
    /\blook\s+up\s+(.+)$/i,
    /(?:سرچ|تلاش)\s+(.+)$/u,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    const q = sanitizePeopleQuery(m?.[1]?.trim().replace(/[.,;]+$/, "") ?? "");
    if (q && q.length >= 2) return q.slice(0, 120);
  }
  return undefined;
}

/** Voice commands for LinkedIn (Tier C). */
export function parseLinkedInCommand(command?: string | null): LinkedInIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd || mentionsOtherApps(cmd)) return null;

  const onLinkedIn = onLinkedInTab();
  const saidLinkedIn = mentionsLinkedIn(cmd);

  if (!saidLinkedIn && !onLinkedIn) return null;

  if (
    (saidLinkedIn || onLinkedIn) &&
    /^\s*open\s+(?:the\s+)?linkedin\s*$/i.test(cmd)
  ) {
    return { kind: "open" };
  }

  if (saidLinkedIn && /\bopen\b/i.test(cmd) && !wantsCreatePost(cmd) && !wantsSearch(cmd)) {
    if (!/\b(search|find|post|draft|create|message)\b/i.test(cmd)) {
      return { kind: "open" };
    }
  }

  if ((wantsSearchPeople(cmd) || (onLinkedIn && wantsSearch(cmd))) && (saidLinkedIn || onLinkedIn)) {
    const query = extractPeopleQuery(cmd);
    if (query) return { kind: "search_people", query };
  }

  if (wantsCreatePost(cmd) && (saidLinkedIn || onLinkedIn)) {
    const text = extractPostText(cmd);
    if (text) {
      return { kind: "create_post", text, publish: wantsPublish(cmd) };
    }
    if (extractPostTopic(cmd)) return null;
    return { kind: "create_post", publish: wantsPublish(cmd) };
  }

  return null;
}

export function isLinkedInCommand(command?: string | null): boolean {
  return parseLinkedInCommand(command) !== null;
}

export function isContextualLinkedInVoiceCommand(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd || !onLinkedInTab() || mentionsOtherApps(cmd)) return false;
  if (mentionsLinkedIn(cmd)) return isLinkedInCommand(cmd);
  return wantsCreatePost(cmd) || wantsSearch(cmd);
}

export function isLinkedInPostGenerationCommand(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return false;
  if (!mentionsLinkedIn(cmd) && !onLinkedInTab()) return false;
  return wantsCreatePost(cmd) && Boolean(extractPostTopic(cmd)) && !extractPostText(cmd);
}

export function isLinkedInTypingBlocked(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? "");
  if (!onLinkedInTab()) return false;
  return isContextualLinkedInVoiceCommand(cmd) || wantsCreatePost(cmd);
}
