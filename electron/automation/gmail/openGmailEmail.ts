import { openUrlInBrowser } from "../openUrl.js";
import { searchSemanticRefs } from "../../storage/semanticEmbeddings.js";
import {
  buildGmailSenderSearchUrl,
  buildGmailSubjectSearchUrl,
  buildGmailAttachmentSearchUrl,
} from "./parseGmailOpenEmail.js";
import { tryOpenCrossAppAttachmentFile } from "./openCrossAppAttachment.js";

function isGmailUrl(url: string): boolean {
  return /mail\.google\.com/i.test(url);
}

function senderMatchesRef(
  senderQuery: string,
  ref: { contact?: string | null; summary: string },
): boolean {
  const q = senderQuery.toLowerCase();
  const contact = ref.contact?.toLowerCase() ?? "";
  const summary = ref.summary.toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  if (contact && (contact.includes(q) || q.includes(contact))) return true;
  if (summary.includes(q)) return true;
  return tokens.some((t) => contact.includes(t) || summary.includes(t));
}

function subjectMatchesRef(
  subjectQuery: string,
  ref: { summary: string },
): boolean {
  const q = subjectQuery.toLowerCase();
  const summary = ref.summary.toLowerCase();
  if (summary.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  return tokens.length > 0 && tokens.every((t) => summary.includes(t));
}

/** Open a remembered Gmail thread or run a Gmail sender search. */
export async function openGmailEmailFromSender(
  senderQuery: string,
): Promise<string> {
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

/** Open a remembered Gmail thread or run a Gmail subject search. */
export async function openGmailEmailBySubject(
  subjectQuery: string,
): Promise<string> {
  const phrase = `email ${subjectQuery}`;
  const refs = searchSemanticRefs(phrase, 12).filter((r) => r.appId === "gmail");

  for (const ref of refs) {
    if (!subjectMatchesRef(subjectQuery, ref)) continue;
    if (ref.refKey && isGmailUrl(ref.refKey)) {
      await openUrlInBrowser(ref.refKey);
      return `Opened Gmail — ${ref.summary.slice(0, 100)}`;
    }
  }

  const url = buildGmailSubjectSearchUrl(subjectQuery);
  await openUrlInBrowser(url);
  return `Gmail search — subject: ${subjectQuery}`;
}

function refKeyUrl(refKey: string): string | null {
  const key = refKey.trim();
  if (!key || !isGmailUrl(key)) return null;
  const pipe = key.indexOf("|");
  if (pipe > 0 && isGmailUrl(key.slice(0, pipe))) return key.slice(0, pipe);
  return key;
}

/** Open Gmail thread with attachment or search has:attachment. */
export async function openGmailThreadWithAttachment(
  extension = "pdf",
): Promise<string> {
  const ext = extension.trim().toLowerCase() || "pdf";
  const local = await tryOpenCrossAppAttachmentFile(`gmail attachment ${ext}`, {
    extension: ext,
  });
  if (local) return local;

  const phrase = `gmail attachment ${ext}`;
  const refs = searchSemanticRefs(phrase, 15).filter((r) => r.appId === "gmail");

  for (const ref of refs) {
    const summary = ref.summary.toLowerCase();
    if (
      !summary.includes("attachment") &&
      !summary.includes(`attachments: ${ext}`) &&
      !summary.includes(`.${ext}`)
    ) {
      continue;
    }
    const url = refKeyUrl(ref.refKey);
    if (url) {
      await openUrlInBrowser(url);
      return `Opened Gmail — ${ref.summary.slice(0, 100)}`;
    }
  }

  const url = buildGmailAttachmentSearchUrl(ext);
  await openUrlInBrowser(url);
  return `Gmail search — emails with ${ext} attachment`;
}
