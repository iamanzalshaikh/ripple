import type { Candidate } from "../planner/types.js";

export type TimeRangeId =
  | "yesterday"
  | "today"
  | "this_morning"
  | "last_week"
  | "last_saturday"
  | "last_sunday"
  | "3_months_ago"
  | `months_${number}_ago`;

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  ek: 1,
  do: 2,
  teen: 3,
};

export type TimeRangeWindow = {
  startMs: number;
  endMs: number;
};

function startOfLocalDay(offsetDays = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

function parseMonthsAgoCount(text: string): number | null {
  const t = text.toLowerCase();
  const m = t.match(
    /\b(?:(\d{1,2})|(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ek|do|teen))\s+months?\s+(?:ago|pehle|pahle|before)\b/,
  );
  if (!m) return null;
  if (m[1]) {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 24 ? n : null;
  }
  const word = m[2]?.toLowerCase();
  return word ? (WORD_NUMBERS[word] ?? null) : null;
}

function lastWeekdayWindow(weekday: number): TimeRangeWindow {
  const now = new Date();
  const current = now.getDay();
  let daysBack = (current - weekday + 7) % 7;
  if (daysBack === 0) daysBack = 7;

  const start = new Date(now);
  start.setDate(now.getDate() - daysBack);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setHours(23, 59, 59, 999);

  return { startMs: start.getTime(), endMs: end.getTime() };
}

/** "Open last pdf" / "open last pdf I opened" — session recall, not calendar search. */
export function isLastOpenedRecallQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  if (
    /^\s*open\s+(?:the\s+)?last\s+(?:pdf|docx?|pptx?|xlsx?|txt|file|video|image|photo|folder)(?![.\w])/i.test(
      t,
    )
  ) {
    if (
      !/\blast\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
        t,
      )
    ) {
      return true;
    }
  }

  if (
    /^\s*open\s+(?:the\s+)?(?:pdf|docx?|pptx?|file|video)\s+I\s+(?:had\s+)?open(?:ed)?\s*\.?\s*$/i.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/** True when speech references a past time — must not route to recall:pdf. */
export function isTemporalFileOpenQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (isLastOpenedRecallQuery(t)) return false;
  if (parseTimeRangeFromText(t)) return true;
  if (
    /\b(?:last\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|yesterday|today|this\s+morning)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(?:opened|edited|worked\s+on|modified|saved)\b/i.test(t) &&
    /\b(?:ago|last|yesterday|week|month|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Parse spoken / NLU time hints into a filter window (P5.3 + P8). */
export function parseTimeRangeFromText(text: string): TimeRangeId | null {
  const t = text.toLowerCase();

  const months = parseMonthsAgoCount(t);
  if (months !== null) {
    if (months === 3) return "3_months_ago";
    return `months_${months}_ago`;
  }

  if (/\bteen\s+mahine?\s+(?:pehle|pahle|ago)\b/.test(t)) return "3_months_ago";
  if (/\blast\s+month\b/.test(t)) return "months_1_ago";
  if (/\blast\s+saturday\b/.test(t)) return "last_saturday";
  if (/\blast\s+sunday\b/.test(t)) return "last_sunday";

  if (/\b(?:last|pichle|pichla)\s+week\b/.test(t)) return "last_week";
  if (/\bthis\s+morning\b/.test(t) || /\b(?:aaj\s+)?subah\b/.test(t)) {
    return "this_morning";
  }
  if (/\b(?:yesterday|kal)(?:'s)?\b/.test(t) || /\bkal\s+(?:wali|ki)\b/.test(t)) {
    return "yesterday";
  }
  if (/\b(?:today|aaj)(?:'s)?\b/.test(t)) return "today";
  return null;
}

/** Parent folder hint from speech — downloads, documents, desktop. */
export function parseParentFolderFromText(text: string): string | undefined {
  const m = text.match(/\b(?:in|from|under)\s+(downloads?|documents?|desktop)\b/i);
  if (!m?.[1]) return undefined;
  const key = m[1].toLowerCase();
  if (key.startsWith("download")) return "downloads";
  if (key.startsWith("document")) return "documents";
  return "desktop";
}

/** Remove filler so retriever token is not the full sentence. */
export function stripRetrieverBoilerplate(token: string): string {
  return token
    .replace(/^[,.:\s]+|[,.:\s]+$/g, "")
    .replace(/\b(?:pdf|pdfs|file|files|document|documents|folder|folders)\b/gi, "")
    .replace(
      /\b(?:which|that|the)\s+(?:i|we|you)\s+(?:opened|edited|worked\s+on|modified|saved|used)\b/gi,
      "",
    )
    .replace(
      /\b(?:i|we|you)\s+(?:opened|edited|worked\s+on|modified|saved|used)\b/gi,
      "",
    )
    .replace(/\b(?:a|an|my|the|mera|meri)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Remove time phrases so retriever token stays a filename hint, not full sentence. */
export function stripTimePhrasesFromToken(token: string): string {
  return stripRetrieverBoilerplate(
    token
      .replace(
        /\b(?:from|in|on)\s+(?:yesterday|today|last\s+week|this\s+morning)\b/gi,
        "",
      )
      .replace(
        /\b(?:\d+|one|two|three|four|five|six|ek|do|teen)\s+months?\s+(?:ago|pehle|pahle|before)\b/gi,
        "",
      )
      .replace(
        /\b(?:I\s+)?(?:edited|worked\s+on|modified|opened|saved)\s+(?:yesterday|today|last\s+week)\b/gi,
        "",
      )
      .replace(/\b(?:kal|aaj|pichle\s+hafte)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function monthsAgoWindow(months: number): TimeRangeWindow {
  const center = new Date();
  center.setMonth(center.getMonth() - months);
  const windowDays = Math.min(45, Math.max(14, months * 7));
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return {
    startMs: center.getTime() - windowMs,
    endMs: center.getTime() + windowMs,
  };
}

export function timeRangeToWindow(range: TimeRangeId): TimeRangeWindow {
  const now = Date.now();
  const monthsMatch = /^months_(\d+)_ago$/.exec(range);
  if (monthsMatch) {
    return monthsAgoWindow(parseInt(monthsMatch[1]!, 10));
  }

  switch (range) {
    case "yesterday":
      return { startMs: startOfLocalDay(-1), endMs: startOfLocalDay(0) };
    case "today":
      return { startMs: startOfLocalDay(0), endMs: now };
    case "this_morning": {
      const morningStart = startOfLocalDay(0);
      const noon = morningStart + 12 * 60 * 60 * 1000;
      return { startMs: morningStart, endMs: Math.min(noon, now) };
    }
    case "last_week":
      return {
        startMs: startOfLocalDay(-7),
        endMs: now,
      };
    case "last_saturday":
      return lastWeekdayWindow(6);
    case "last_sunday":
      return lastWeekdayWindow(0);
    case "3_months_ago":
      return monthsAgoWindow(3);
  }
}

export function filterCandidatesByTimeRange(
  candidates: Candidate[],
  range: TimeRangeId,
): Candidate[] {
  const { startMs, endMs } = timeRangeToWindow(range);
  return candidates.filter((c) => {
    if (c.mtime === undefined) return true;
    return c.mtime >= startMs && c.mtime < endMs;
  });
}

export function parseExtensionFromText(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\b(?:images?|photos?|pictures?|screenshots?)\b/.test(t)) {
    return "image";
  }
  if (/\b(?:videos?|screen\s*recordings?|recordings?)\b/.test(t)) {
    return "video";
  }
  const m = t.match(
    /\b(pdf|docx?|xlsx?|pptx?|txt|png|jpe?g|webp|gif|mp4|mov|mkv|webm|m4v|avi)\b/i,
  );
  return m?.[1]?.toLowerCase();
}

export function isMediaAliasExtension(
  ext: string | undefined,
): ext is "image" | "video" {
  return ext === "image" || ext === "video";
}

export function isOpenedTimeQuery(text: string): boolean {
  return /\b(?:opened|open|khola|kholi|used|saved)\b/i.test(text);
}
