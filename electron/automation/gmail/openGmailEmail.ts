import { openUrlInBrowser } from "../openUrl.js";
import { searchSemanticRefs } from "../../storage/semanticEmbeddings.js";
import {
  buildGmailSenderSearchUrl,
} from "./parseGmailOpenEmail.js";

function isGmailUrl(url: string): boolean {
  return /mail\.google\.com/i.test(url);
}

function senderMatchesRef(senderQuery: string, ref: { contact?: string | null; summary: string }): boolean {
  const q = senderQuery.toLowerCase();
  const contact = ref.contact?.toLowerCase() ?? "";
  const summary = ref.summary.toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  if (contact && (contact.includes(q) || q.includes(contact))) return true;
  if (summary.includes(q)) return true;
  return tokens.some((t) => contact.includes(t) || summary.includes(t));
}

/** Open a remembered Gmail thread or run a Gmail sender search. */
export async function openGmailEmailFromSender(senderQuery: string): Promise<string> {
  const phrase = `email from ${senderQuery}`;
  const refs = searchSemanticRefs(phrase, 12).filter((r) => r.appId === "gmail");

  for (const ref of refs) {
    if (!senderMatchesRef(senderQuery, ref)) continue;
    if (ref.refKey && isGmailUrl(ref.refKey)) {
      await openUrlInBrowser(ref.refKey);
      return `Opened Gmail — ${ref.summary.slice(0, 100)}`;
    }
  }

  const url = buildGmailSenderSearchUrl(senderQuery);
  await openUrlInBrowser(url);
  return `Gmail search — emails from ${senderQuery}`;
}
