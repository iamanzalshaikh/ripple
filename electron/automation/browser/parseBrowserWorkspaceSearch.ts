import { normalizeTranscript } from "../voice/normalizeTranscript.js";

export type BrowserSearchIntent = {
  kind: "browser_search";
  query: string;
};

const FILE_SEARCH_TOKENS =
  /\b(?:resume|cv|pdf|document|spreadsheet|download|folder|file|image|photo|screenshot|recording|presentation|deck|invoice)\b/i;

const WEB_SEARCH_SITE =
  /\b(?:on|in|at)\s+(?:google|chrome|browser|web|internet)\b/i;

/**
 * Web search in the active browser tab — not file/index smart_search.
 * "search cats", "search for react hooks"
 */
export function parseBrowserWorkspaceSearch(
  command?: string | null,
): BrowserSearchIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  const match = cmd.match(/^\s*search\s+(?:for\s+)?(.+?)\s*$/i);
  if (!match?.[1]?.trim()) return null;

  let query = match[1].trim();
  query = query.replace(WEB_SEARCH_SITE, "").trim();
  if (!query || query.length < 2) return null;

  if (FILE_SEARCH_TOKENS.test(query)) return null;
  if (
    /\b(?:season|episode|ep\s*\d|s\d+\s*e\d+|trailer|movie|song|video|watch|play)\b/i.test(
      cmd,
    )
  ) {
    return null;
  }
  if (
    /\b(?:on|in|at)\s+(?:linkedin|instagram|youtube|notion|whatsapp|gmail|google\s*mail|facebook|twitter|slack|discord)\b/i.test(
      cmd,
    )
  ) {
    return null;
  }

  return { kind: "browser_search", query };
}

export function buildBrowserSearchUrl(query: string): string {
  const params = new URLSearchParams();
  params.set("q", query.trim());
  return `https://www.google.com/search?${params.toString()}`;
}
