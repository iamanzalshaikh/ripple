const BLOCKED_TARGETS =
  /^(?:cursor|notepad|chrome|edge|firefox|brave|calculator|vscode?|vs\s*code|visual\s+studio\s+code|whatsapp|youtube|linkedin|instagram|gmail|notion|teams|slack|outlook|explorer|file\s+explorer|downloads?|documents?|desktop|paint|settings|terminal|powershell|cmd)$/i;

export type OpenUrlIntent = { url: string };

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/[.,!?]+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return `https://${trimmed}`;
}

function looksLikeUrl(target: string): boolean {
  if (/^https?:\/\//i.test(target)) return true;
  if (/^www\./i.test(target)) return true;
  return /^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}(?:\/\S*)?$/i.test(target);
}

/** L0 parse for generic "open github.com" / "go to https://…" utterances. */
export function parseOpenUrlCommand(
  command?: string | null,
): OpenUrlIntent | null {
  const cmd = (command ?? "").trim();
  if (!cmd) return null;

  if (
    /\b(?:whatsapp|youtube|linkedin|instagram|gmail|notion|on\s+whatsapp|on\s+youtube)\b/i.test(
      cmd,
    )
  ) {
    return null;
  }

  const patterns = [
    /^(?:open|go\s+to|navigate\s+to|visit|browse\s+to)\s+(https?:\/\/\S+)(?:\s+in\s+(?:my\s+)?browser)?\s*$/i,
    /^(?:open|go\s+to|navigate\s+to|visit|browse\s+to)\s+(www\.\S+)(?:\s+in\s+(?:my\s+)?browser)?\s*$/i,
    /^(?:open|go\s+to|navigate\s+to|visit|browse\s+to)\s+([a-z0-9][-a-z0-9.]*\.[a-z]{2,}(?:\/\S*)?)(?:\s+in\s+(?:my\s+)?browser)?\s*$/i,
    /^(?:open|go\s+to|navigate\s+to|visit|browse\s+to)\s+(.+?\s+documentation\s+website)\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = cmd.match(pattern);
    const target = match?.[1]?.trim();
    if (!target || !looksLikeUrl(target)) {
      if (target && /documentation\s+website/i.test(target)) {
        return { url: "https://react.dev" };
      }
      continue;
    }
    const bare = target.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    const host = bare.split("/")[0] ?? bare;
    if (BLOCKED_TARGETS.test(host) || BLOCKED_TARGETS.test(bare)) continue;
    return { url: normalizeUrl(target) };
  }

  return null;
}
