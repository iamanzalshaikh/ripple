import type { Candidate } from "../planner/types.js";

export type TimeRangeId =
  | "yesterday"
  | "today"
  | "this_morning"
  | "last_week"
  | "3_months_ago";

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

/** Parse spoken / NLU time hints into a filter window (P5.3). */
export function parseTimeRangeFromText(text: string): TimeRangeId | null {
  const t = text.toLowerCase();
  if (/\b(?:3|three)\s+months?\s+ago\b/.test(t)) return "3_months_ago";
  if (/\blast\s+week\b/.test(t)) return "last_week";
  if (/\bthis\s+morning\b/.test(t)) return "this_morning";
  if (/\byesterday(?:'s)?\b/.test(t)) return "yesterday";
  if (/\btoday(?:'s)?\b/.test(t)) return "today";
  return null;
}

export function timeRangeToWindow(range: TimeRangeId): TimeRangeWindow {
  const now = Date.now();

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
    case "3_months_ago": {
      const center = new Date();
      center.setMonth(center.getMonth() - 3);
      const windowMs = 14 * 24 * 60 * 60 * 1000;
      return {
        startMs: center.getTime() - windowMs,
        endMs: center.getTime() + windowMs,
      };
    }
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
  const m = text.match(/\b(pdf|docx?|xlsx?|pptx?|txt|png|jpe?g)\b/i);
  return m?.[1]?.toLowerCase();
}
