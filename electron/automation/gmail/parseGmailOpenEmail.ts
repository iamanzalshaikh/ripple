export type GmailOpenEmailIntent = {
  kind: "open_gmail_email";
  senderQuery?: string;
  subjectQuery?: string;
  attachmentQuery?: string;
};

/** "Open Gmail thread with pdf attached", "Open email with attachment". */
export function parseGmailOpenAttachmentCommand(
  command?: string | null,
): GmailOpenEmailIntent | null {
  const cmd = (command ?? "").trim();
  if (!/^\s*open\b/i.test(cmd)) return null;

  const mentionsMail = /\bgmail\b/i.test(cmd) || /\b(?:mail|email)s?\b/i.test(cmd);
  const mentionsAttach =
    /\b(?:attachment|attached|attach)\b/i.test(cmd) ||
    /\bgmail\s+thread\b/i.test(cmd) ||
    /\bthread\s+with\b/i.test(cmd);
  if (!mentionsMail || !mentionsAttach) return null;

  const ext =
    cmd.match(
      /\b(pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|csv|txt)\b/i,
    )?.[1]?.toLowerCase() ?? "pdf";

  return { kind: "open_gmail_email", attachmentQuery: ext };
}

/** "Open email from Naukri Campus", "Open a mail from Ahmed". */
export function parseGmailOpenEmailFromCommand(
  command?: string | null,
): GmailOpenEmailIntent | null {
  const cmd = (command ?? "").trim();
  const m = cmd.match(
    /^\s*open\s+(?:a\s+|an\s+|the\s+)?(?:mail|email)s?\s+from\s+(.+?)\s*$/i,
  );
  if (!m?.[1]?.trim()) return null;
  return { kind: "open_gmail_email", senderQuery: m[1].trim() };
}

/** "Open the Naukri shortlist email", "Open email about job shortlist". */
export function parseGmailOpenEmailBySubjectCommand(
  command?: string | null,
): GmailOpenEmailIntent | null {
  const cmd = (command ?? "").trim();

  const explicit = cmd.match(
    /^\s*open\s+(?:the\s+|a\s+|an\s+)?(?:mail|email)s?\s+(?:about|on|regarding|with\s+subject)\s+(.+?)\s*$/i,
  );
  if (explicit?.[1]?.trim()) {
    return { kind: "open_gmail_email", subjectQuery: explicit[1].trim() };
  }

  const trailing = cmd.match(
    /^\s*open\s+(?:the\s+|a\s+|an\s+)?(.+?)\s+(?:mail|email)s?\s*$/i,
  );
  if (trailing?.[1]?.trim()) {
    const subject = trailing[1].trim();
    if (/^(?:mail|email)s?\s+from\b/i.test(subject)) return null;
    if (/\bfrom\s+/i.test(subject)) return null;
    if (subject.length >= 3) {
      return { kind: "open_gmail_email", subjectQuery: subject };
    }
  }

  return null;
}

/** Gmail voice — sender, subject, or attachment search. */
export function parseGmailOpenEmailCommand(
  command?: string | null,
): GmailOpenEmailIntent | null {
  return (
    parseGmailOpenEmailFromCommand(command) ??
    parseGmailOpenAttachmentCommand(command) ??
    parseGmailOpenEmailBySubjectCommand(command)
  );
}

export function buildGmailAttachmentSearchUrl(extension = "pdf"): string {
  const ext = extension.trim().toLowerCase() || "pdf";
  const search = `has:attachment ${ext}`;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(search)}`;
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

export function buildGmailSubjectSearchUrl(subjectQuery: string): string {
  const q = subjectQuery.trim();
  const search = `subject:${q}`;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(search)}`;
}
