import { formatMessageBody } from "./emailFormat.js";

export interface ParsedEmail {
  to?: string;
  subject?: string;
  body: string;
}

const EMAIL_RE = /[a-z0-9][\w.+-]*@[\w.-]+\.[a-z]{2,}/i;
const DEAR_RE = /\bDear\s+/i;

function normalizeEmail(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,;:!?)]+$/, "");
}

/** Fix STT: "name @ gmail.com" or "name at gmail.com" → email */
function normalizeSpeechEmailPhrases(text: string): string {
  return text
    .replace(
      /\b([a-z0-9][\w.+-]*)\s*@\s*([a-z0-9][\w.-]*\.[a-z]{2,})\b/gi,
      "$1@$2",
    )
    .replace(
      /\b([a-z0-9][\w.+-]*)\s+at\s+(?:a\s+rate\s+|the\s+)?gmail\.com\b/gi,
      "$1@gmail.com",
    );
}

/**
 * Pull recipient from the voice command (not AI body).
 * Handles: saaliq@gmail.com, to salik at gmail.com, write mail to X@Y.com
 */
export function extractRecipientFromCommand(command: string): string | undefined {
  const normalized = normalizeSpeechEmailPhrases(command.trim());
  if (!normalized) return undefined;

  const toExplicit = normalized.match(
    /\bto\s+([a-z0-9][\w.+-]*@[\w.-]+\.[a-z]{2,})\b/i,
  );
  if (toExplicit) return normalizeEmail(toExplicit[1]);

  const allEmails = normalized.match(
    /[a-z0-9][\w.+-]*@[\w.-]+\.[a-z]{2,}/gi,
  );
  if (allEmails?.length) {
    return normalizeEmail(allEmails[0]);
  }

  const toAtGmail = normalized.match(
    /\bto\s+([a-z0-9][\w.-]*)\s+at\s+gmail\.com/i,
  );
  if (toAtGmail) {
    return `${toAtGmail[1].toLowerCase()}@gmail.com`;
  }

  const mailToName = normalized.match(
    /\b(?:mail|email|message)\s+to\s+([a-z0-9][\w.-]*)\s+at\s+gmail/i,
  );
  if (mailToName) {
    return `${mailToName[1].toLowerCase()}@gmail.com`;
  }

  const writeToName = normalized.match(
    /\bwrite\s+(?:a\s+)?(?:mail|email)\s+to\s+([a-z0-9][\w.-]*)(?:\s+at\s+gmail)?/i,
  );
  if (writeToName && !writeToName[1].includes("@")) {
    const name = writeToName[1].toLowerCase();
    if (normalized.includes("gmail")) {
      return `${name}@gmail.com`;
    }
  }

  return undefined;
}

/** First line only — subject must not include the letter body. */
function extractSubjectLineValue(afterLabel: string): string {
  let s = afterLabel.trim();
  const dearAt = s.search(DEAR_RE);
  if (dearAt > 0) {
    s = s.slice(0, dearAt).trim();
  }
  const nl = s.indexOf("\n");
  if (nl >= 0) {
    s = s.slice(0, nl).trim();
  }
  if (s.length > 120) {
    s = s.slice(0, 120).trim();
  }
  return s;
}

function extractBody(text: string, subject?: string): string {
  let body = text.trim();

  const dearMatch = body.match(/\n\s*(Dear\s[\s\S]*)/i);
  if (dearMatch) {
    return dearMatch[1].trim();
  }

  const inlineDear = body.search(DEAR_RE);
  if (inlineDear > 0) {
    return body.slice(inlineDear).trim();
  }

  if (subject) {
    body = body.replace(/^Subject:\s*.+$/im, "").trim();
    if (body.toLowerCase().startsWith(subject.toLowerCase())) {
      body = body.slice(subject.length).trim();
    }
  }

  body = body.replace(/^Subject:\s*.+$/gim, "").trim();
  return body;
}

function stripLeadingBlocks(text: string): { to?: string; subject?: string; rest: string } {
  let rest = text.trim();
  let to: string | undefined;
  let subject: string | undefined;

  for (let pass = 0; pass < 6; pass++) {
    const toLine = rest.match(/^To:\s*(.+)$/im);
    if (toLine) {
      const addr = toLine[1].match(EMAIL_RE)?.[0] ?? toLine[1].trim();
      to = normalizeEmail(addr);
      rest = rest.slice(toLine[0].length).trim();
      continue;
    }

    const subjectMatch = rest.match(/^Subject:\s*([\s\S]*)/i);
    if (subjectMatch) {
      subject = extractSubjectLineValue(subjectMatch[1]);
      const afterLabel = subjectMatch[1];
      const dearAt = afterLabel.search(DEAR_RE);
      if (dearAt >= 0) {
        rest = afterLabel.slice(dearAt).trim();
      } else {
        const nl = afterLabel.indexOf("\n");
        rest = nl >= 0 ? afterLabel.slice(nl + 1).trim() : "";
      }
      continue;
    }
    break;
  }

  return { to, subject, rest };
}

/** Parse AI email text into To / Subject / Body (Electron-only). */
export function parseEmailContent(
  text: string,
  hints?: { to?: string; subject?: string; body?: string; command?: string },
): ParsedEmail {
  if (hints?.body && (hints.to || hints.subject)) {
    return {
      to: hints.to,
      subject: hints.subject,
      body: hints.body,
    };
  }

  const commandTo = hints?.command
    ? extractRecipientFromCommand(hints.command)
    : undefined;

  const { to: lineTo, subject: lineSubject, rest } = stripLeadingBlocks(text);

  let to = hints?.to ?? commandTo ?? lineTo;
  let subject = hints?.subject ?? lineSubject;
  let body = hints?.body ?? extractBody(rest || text, subject);

  if (!to) {
    const mail = text.match(EMAIL_RE)?.[0] ?? body.match(EMAIL_RE)?.[0];
    if (mail) to = normalizeEmail(mail);
  }

  if (!subject) {
    const subjInText = text.match(/^Subject:\s*(.+)$/im);
    if (subjInText) {
      subject = extractSubjectLineValue(subjInText[1]);
    }
  }

  if (!body || body.length < 10) {
    body = extractBody(text, subject);
  }

  body = body.replace(/^Subject:\s*.+$/gim, "").trim();

  const result: ParsedEmail = {
    to,
    subject,
    body: body || text.trim(),
  };

  result.body = formatMessageBody(result, text);
  return result;
}

export function hasStructuredEmailFields(parsed: ParsedEmail): boolean {
  return Boolean(parsed.to || parsed.subject);
}

export function isLikelyEmailContent(text: string): boolean {
  return (
    /^Subject:\s*/im.test(text) ||
    DEAR_RE.test(text) ||
    /^To:\s*/im.test(text) ||
    EMAIL_RE.test(text)
  );
}
