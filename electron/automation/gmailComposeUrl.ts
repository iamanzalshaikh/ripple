import { openUrlInBrowser } from "./openUrl.js";
import type { ParsedEmail } from "./emailParse.js";

/**
 * Open Gmail compose with To / Subject / Body pre-filled via URL params.
 * No clicking or Tab navigation — works every time.
 */
export function buildGmailComposeUrl(parsed: ParsedEmail): string {
  const params = new URLSearchParams();
  params.set("view", "cm");
  params.set("fs", "1");
  params.set("tf", "cm");
  if (parsed.to) {
    params.set("to", parsed.to.trim());
  }
  if (parsed.subject) {
    params.set("su", parsed.subject.trim());
  }
  if (parsed.body) {
    params.set("body", parsed.body);
  }
  const qs = params.toString();
  return `https://mail.google.com/mail/u/0/?${qs}#compose=new`;
}

export async function openGmailCompose(parsed: ParsedEmail): Promise<string> {
  const url = buildGmailComposeUrl(parsed);
  console.info(`[ripple-desktop] opening Gmail compose URL (${url.length} chars)`);
  await openUrlInBrowser(url);

  const parts: string[] = [];
  if (parsed.to) parts.push(`To: ${parsed.to}`);
  if (parsed.subject) parts.push(`Subject: ${parsed.subject.slice(0, 40)}`);
  if (parsed.body) parts.push(`Body (${parsed.body.length} chars)`);

  return `Gmail compose opened — ${parts.join(" · ")}`;
}
