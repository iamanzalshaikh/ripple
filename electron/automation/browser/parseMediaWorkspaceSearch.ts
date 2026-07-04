import { normalizeTranscript } from "../voice/normalizeTranscript.js";

const MEDIA_SIGNALS =
  /\b(?:season|episode|ep\s*\d|s\d+\s*e\d+|trailer|movie|song|video|watch|play)\b/i;

/**
 * Media-style search (YouTube-oriented) — season/episode/show queries.
 */
export function parseMediaWorkspaceSearch(
  command?: string | null,
): { query: string } | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  const match = cmd.match(/^\s*search\s+(?:for\s+)?(.+?)\s*$/i);
  if (!match?.[1]?.trim()) return null;

  if (!MEDIA_SIGNALS.test(cmd)) return null;

  return { query: match[1].trim() };
}

export function isMediaSearchClause(command: string): boolean {
  return MEDIA_SIGNALS.test(command);
}

export { buildYouTubeSearchUrl } from "../adapters/youtube/searchVideo.js";
