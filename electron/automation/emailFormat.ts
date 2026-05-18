import type { ParsedEmail } from "./emailParse.js";

/**
 * Clean body for Gmail / WhatsApp / in-place edit:
 * - no Subject/To headers in body
 * - no duplicate subject line at top
 * - starts at "Dear …" when present
 * - proper paragraph spacing (blank line between blocks)
 */
export function formatMessageBody(
  parsed: ParsedEmail,
  rawAiText?: string,
): string {
  let body = (parsed.body || rawAiText || "").trim();
  if (!body) return "";

  body = body
    .replace(/^Subject:\s*.+$/gim, "")
    .replace(/^To:\s*.+$/gim, "")
    .trim();

  if (parsed.subject) {
    const subj = parsed.subject.trim();
    const firstLine = body.split(/\n/)[0]?.trim() ?? "";
    if (
      firstLine.toLowerCase() === subj.toLowerCase() ||
      body.toLowerCase().startsWith(subj.toLowerCase())
    ) {
      if (firstLine.toLowerCase() === subj.toLowerCase()) {
        body = body.slice(firstLine.length).trim();
      } else {
        body = body.slice(subj.length).trim();
      }
    }
  }

  const dearMatch = body.match(/\bDear\s+[\s\S]*/i);
  if (dearMatch) {
    body = dearMatch[0].trim();
  }

  body = body.replace(/\r\n/g, "\n");
  body = body.replace(/[ \t]+\n/g, "\n");
  body = body.replace(/\n{3,}/g, "\n\n");
  body = body.replace(/([.!?])\s*\n([A-Z])/g, "$1\n\n$2");
  body = body.replace(/^(Dear\s+[^,\n]+,)\s*\n(?!\n)/im, "$1\n\n");

  const closingMatch = body.match(/\n\n(Best regards|Sincerely|Thanks|Thank you)/i);
  if (closingMatch?.index && closingMatch.index > 0) {
    const idx = closingMatch.index;
    const before = body.slice(0, idx).trimEnd();
    const after = body.slice(idx).trim();
    if (!before.endsWith("\n\n")) {
      body = `${before}\n\n${after}`;
    }
  }

  return body.trim();
}

/** Apply formatting to parsed email before send. */
export function finalizeParsedEmail(
  parsed: ParsedEmail,
  rawAiText: string,
): ParsedEmail {
  return {
    to: parsed.to,
    subject: parsed.subject?.trim(),
    body: formatMessageBody(parsed, rawAiText),
  };
}
