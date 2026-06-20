import { isYouTubeFocused, isWhatsAppTabActive } from "../../../focus/focusContext.js";
import { parseWorkflowMetaCommand } from "../../desktop/parseWorkflowCommand.js";
import { isRememberWorkflowPhrase } from "../../desktop/spokenName.js";
import { normalizeTranscript } from "../../voice/normalizeTranscript.js";

export type YouTubeIntent =
  | { kind: "open" }
  | { kind: "search"; query: string }
  | { kind: "play"; query: string };

const OTHER_APPS =
  /\b(gmail|google\s*mail|whatsapp|notion|linkedin|instagram|slack|discord|spotify)\b/i;

function mentionsYouTube(cmd: string): boolean {
  return /\byoutube\b/i.test(cmd) || /یوٹیوب/u.test(cmd);
}

function mentionsOtherApps(cmd: string): boolean {
  return OTHER_APPS.test(cmd);
}

function cleanQuery(raw: string): string | undefined {
  let q = raw
    .trim()
    .replace(/^(?:سرچ|تلاش|ڈھونڈ)\s+/u, "")
    .replace(/\s+(?:on|in)\s+youtube\s*$/i, "")
    .replace(/\s+(?:یوٹیوب|یوٹوب)\s*$/u, "")
    .replace(/\s+پر\s*$/u, "")
    .replace(/[.,;]+$/, "")
    .trim();
  q = normalizeUrduMediaQuery(q);
  if (q.length < 2) return undefined;
  return q.slice(0, 200);
}

/** Urdu season/episode cues → English for YouTube search ranking. */
function normalizeUrduMediaQuery(q: string): string {
  return q
    .replace(/س[یي]زن\s+ون/giu, "Season 1")
    .replace(/س[یي]زن\s+ٹو/giu, "Season 2")
    .replace(/س[یي]زن\s+تھری/giu, "Season 3")
    .replace(/اپیسو[ڈدٹ]\s+ون/giu, "Episode 1")
    .replace(/اپیسو[ڈدٹ]\s+ٹو/giu, "Episode 2")
    .replace(/اپیسو[ڈدٹ]\s+تھری/giu, "Episode 3")
    .replace(/اپیسو[ڈدٹ]\s+فور/giu, "Episode 4")
    .replace(/اپیسو[ڈدٹ]\s+فائیو/giu, "Episode 5");
}

/** Pull search/play query from voice transcript. */
export function extractYouTubeSearchQuery(
  cmd: string,
  opts?: { allowWithoutYouTubeWord?: boolean },
): string | undefined {
  const allowShort = opts?.allowWithoutYouTubeWord === true;

  const patterns: RegExp[] = [
    // Combined intents
    /\bopen\s+(?:the\s+)?youtube\b.*\bsearch\b\s+(?:for\s+)?(.+)$/i,
    /\bopen\s+(?:the\s+)?youtube\b.*\bplay\b\s+(.+)$/i,
    /\bopen\s+(?:the\s+)?youtube\b.*\bwatch\b\s+(.+)$/i,
    /\bsearch\s+youtube\s+for\s+(.+)$/i,
    /\bsearch\s+(?:on\s+)?youtube\s+for\s+(.+)$/i,
    /\byoutube\s+search\s+(?:for\s+)?(.+)$/i,
    /\b(?:search|find|play|watch)\s+(?:for\s+)?(.+?)\s+on\s+youtube\s*\.?\s*$/i,
    /\bplay\s+(.+?)\s+on\s+youtube\s*\.?\s*$/i,
    /\bwatch\s+(.+?)\s+on\s+youtube\s*\.?\s*$/i,
    // "search X" even if "for" omitted
    /\bsearch\s+youtube\s+(.+)$/i,
    /\bsearch\s+(?:on\s+)?youtube\s+(.+)$/i,
    /(?:سرچ|تلاش)\s+(.+?)\s+(?:پر\s+)?(?:یوٹیوب)/u,
    /(?:سرچ|تلاش)\s+(.+)$/u,
  ];

  if (allowShort) {
    patterns.push(/^\s*(?:search|find|play|watch)\s+(?:for\s+)?(.+)$/i);
  }

  for (const re of patterns) {
    const m = cmd.match(re);
    const q = cleanQuery(m?.[1] ?? "");
    if (q) return q;
  }

  return undefined;
}

function wantsSearchOrPlay(cmd: string): boolean {
  return (
    /\b(search|find|play|watch|look\s+up)\b/i.test(cmd) ||
    /(?:سرچ|تلاش|ڈھونڈ|چلاؤ|دیکھو)/u.test(cmd)
  );
}

/** Voice commands for YouTube (B4). */
export function parseYouTubeCommand(command?: string | null): YouTubeIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd || mentionsOtherApps(cmd)) return null;

  if (
    /^\s*(?:remember|replace)\s+/i.test(cmd) &&
    (parseWorkflowMetaCommand(cmd) || isRememberWorkflowPhrase(cmd))
  ) {
    return null;
  }

  const onYouTube = isYouTubeFocused();
  const saidYouTube = mentionsYouTube(cmd);

  // On WhatsApp tab, only route to YouTube when user explicitly says YouTube.
  if (isWhatsAppTabActive() && !saidYouTube) return null;

  const queryFromVoice = extractYouTubeSearchQuery(cmd, {
    allowWithoutYouTubeWord: onYouTube && !saidYouTube,
  });

  if (queryFromVoice && (saidYouTube || onYouTube)) {
    const kind = /\bplay\b/i.test(cmd) ? "play" : "search";
    return { kind, query: queryFromVoice };
  }

  if (
    saidYouTube &&
    /^\s*open\s+(?:the\s+)?youtube\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "open" };
  }

  if (saidYouTube && /\bopen\b/i.test(cmd) && !wantsSearchOrPlay(cmd)) {
    return { kind: "open" };
  }

  if (onYouTube && wantsSearchOrPlay(cmd) && !saidYouTube) {
    const q = extractYouTubeSearchQuery(cmd, { allowWithoutYouTubeWord: true });
    if (q) {
      return { kind: /\bplay\b/i.test(cmd) ? "play" : "search", query: q };
    }
  }

  return null;
}

export function isYouTubeCommand(command?: string | null): boolean {
  return parseYouTubeCommand(command) !== null;
}

export function isContextualYouTubeVoiceCommand(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd || !isYouTubeFocused() || mentionsOtherApps(cmd)) return false;
  if (mentionsYouTube(cmd)) return isYouTubeCommand(cmd);
  return wantsSearchOrPlay(cmd) && Boolean(extractYouTubeSearchQuery(cmd, { allowWithoutYouTubeWord: true }));
}

/** True when utterance is probably a YouTube search/play (for LLM routing). */
export function isLikelyYouTubeSearchCommand(command?: string | null): boolean {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return false;
  if (mentionsOtherApps(cmd)) return false;
  if (isWhatsAppTabActive() && !/\byoutube\b/i.test(cmd) && !/(?:یوٹیوب|یوٹوب)/u.test(cmd)) {
    return false;
  }
  if (/\byoutube\b/i.test(cmd) || /(?:یوٹیوب|یوٹوب)/u.test(cmd)) {
    return wantsSearchOrPlay(cmd);
  }
  if (isYouTubeFocused()) {
    return wantsSearchOrPlay(cmd);
  }
  return false;
}
