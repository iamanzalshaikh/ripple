export type GmailOpenEmailIntent = {
  kind: "open_gmail_email";
  senderQuery: string;
};

/** "Open email from Naukri Campus", "Open a mail from Ahmed". */
export function parseGmailOpenEmailCommand(
  command?: string | null,
): GmailOpenEmailIntent | null {
  const cmd = (command ?? "").trim();
  const m = cmd.match(
    /^\s*open\s+(?:a\s+|an\s+|the\s+)?(?:mail|email)s?\s+from\s+(.+?)\s*$/i,
  );
  if (!m?.[1]?.trim()) return null;
  return { kind: "open_gmail_email", senderQuery: m[1].trim() };
}

export function buildGmailSenderSearchUrl(senderQuery: string): string {
  const q = senderQuery.trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  const fromToken = tokens[0] ?? q;
  const search =
    tokens.length > 1
      ? `from:${fromToken} OR ${tokens.join(" ")}`
      : `from:${fromToken}`;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(search)}`;
}
