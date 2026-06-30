/** Strip trailing punctuation Whisper adds to names. */
export function sanitizeSpokenName(name: string): string {
  return name.trim().replace(/[,;:.!?]+$/g, "").trim();
}

export function normalizeRegistryKey(name: string): string {
  return sanitizeSpokenName(name).toLowerCase().replace(/\s+/g, " ");
}

/** Self-correction: "Start study mode. Sorry, start work mode" → work mode */
export function extractLastRunPhrase(cmd: string): string | null {
  const hinglish = cmd.match(
    /(?:^|\s)(?:mera\s+|my\s+)?(.+?)\s+(?:chalu|shuru)\s+karo\s*\.?\s*$/i,
  );
  if (hinglish?.[1]) {
    return sanitizeSpokenName(hinglish[1]);
  }

  const matches = [
    ...cmd.matchAll(/(?:start|run|launch)\s+(?:my\s+)?([^.,;]+)/gi),
  ];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1][1];
  return sanitizeSpokenName(last);
}

/** True when user is teaching a multi-step workflow, not opening one app. */
export function isRememberWorkflowPhrase(cmd: string): boolean {
  if (!/^\s*remember\s+/i.test(cmd)) return false;
  if (/\s+opens?\s+/i.test(cmd)) return true;
  if (/\s+open\s+/i.test(cmd)) return true;
  if (/,\s*open[,\s]/i.test(cmd)) return true;
  const rememberIs = cmd.match(/^\s*remember\s+.+\s+is\s+(.+)$/i);
  if (rememberIs?.[1]) {
    const rest = rememberIs[1];
    if (rest.includes(",") || /\s+and\s+/i.test(rest)) {
      if (!/\b(in\s+)?(downloads?|documents?|desktop)\b/i.test(rest)) {
        return true;
      }
    }
  }
  return false;
}
