import { parseExtensionFromText } from "./timeRange.js";
import { isSemanticQuery } from "./parseSemanticQuery.js";

export type SemanticOpenQuery = {
  phrase: string;
  extension?: string;
  lifeEventTopic?: string;
  contactTopic?: string;
};

export type RememberLifeEventIntent = {
  kind: "remember_life_event";
  label: string;
  topic: string;
  eventAt: string;
};

/** P8b — "open PDF I discussed with Ahmed", "before my Goa trip". */
export function parseSemanticOpenCommand(
  command?: string | null,
): SemanticOpenQuery | null {
  const cmd = (command ?? "").trim();
  if (!cmd || !/^\s*open\b/i.test(cmd)) return null;
  if (!isSemanticQuery(cmd)) return null;

  const extension = parseExtensionFromText(cmd);

  const beforeMy = cmd.match(/\bbefore\s+my\s+(.+?)\s*$/i);
  if (beforeMy?.[1]) {
    return {
      phrase: cmd,
      extension,
      lifeEventTopic: beforeMy[1].trim(),
    };
  }

  const discussed = cmd.match(
    /\b(?:pdf|file|document|doc|image|video|folder|project|resume|presentation)\b.*\b(?:discussed|shared|sent|talked)\s+(?:with|to|from)\s+([A-Za-z][A-Za-z0-9_-]{1,24})\b/i,
  );
  if (discussed?.[1]) {
    return {
      phrase: cmd,
      extension,
      contactTopic: discussed[1].trim(),
    };
  }

  const thatThing = cmd.match(
    /\b(?:that|the)\s+thing\s+([A-Za-z][A-Za-z0-9_-]{1,24})\s+sent\b/i,
  );
  if (thatThing?.[1]) {
    return {
      phrase: cmd,
      extension,
      contactTopic: thatThing[1].trim(),
    };
  }

  if (
    /\b(?:discussed|meeting|talked|sent|from)\s+(?:with|to|by|from)\b/i.test(
      cmd,
    ) ||
    /\bthat\s+thing\b/i.test(cmd) ||
    /\b(?:document|file|pdf|project)\s+(?:about|for|from)\b/i.test(cmd)
  ) {
    return { phrase: cmd, extension };
  }

  return null;
}

/** "Remember my Goa trip was March 15 2025" */
export function parseRememberLifeEventCommand(
  command?: string | null,
): { label: string; topic: string; eventAt: string } | null {
  const cmd = (command ?? "").trim();
  const m = cmd.match(
    /^\s*remember\s+my\s+(.+?)\s+(?:was|is|on)\s+(.+?)\s*$/i,
  );
  if (!m?.[1] || !m[2]) return null;

  const label = m[1].trim();
  const dateRaw = m[2].trim();
  const eventAt = parseSpokenDate(dateRaw);
  if (!eventAt) return null;

  return {
    label,
    topic: label.toLowerCase().replace(/\s+/g, " "),
    eventAt,
  };
}

function parseSpokenDate(raw: string): string | null {
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString();
  }

  const monthYear = raw.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i,
  );
  if (monthYear) {
    const parsed = new Date(`${monthYear[1]} 15, ${monthYear[2]}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}
