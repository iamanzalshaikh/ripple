import { openUrlInBrowser } from "../openUrl.js";
import { searchSemanticRefs } from "../../storage/semanticEmbeddings.js";

function isCrossAppUrl(url: string): boolean {
  return /mail\.google\.com|web\.whatsapp\.com|outlook\.(live|office)|teams\.microsoft\.com/i.test(
    url,
  );
}

function refKeyUrl(refKey: string): string | null {
  const key = refKey.trim();
  if (!key || !isCrossAppUrl(key)) return null;
  const pipe = key.indexOf("|");
  if (pipe > 0 && isCrossAppUrl(key.slice(0, pipe))) {
    return key.slice(0, pipe);
  }
  if (isCrossAppUrl(key)) return key;
  return null;
}

/** When no local file exists, open Gmail/WhatsApp thread from attachment memory. */
export async function tryOpenCrossAppSemanticRef(
  phrase: string,
): Promise<string | null> {
  const refs = searchSemanticRefs(phrase, 15);
  const phraseLower = phrase.toLowerCase();

  for (const ref of refs) {
    const summary = ref.summary.toLowerCase();
    const contact = ref.contact?.toLowerCase() ?? "";
    const isAttachment = summary.includes("attachment:");
    const contactHit =
      contact && (phraseLower.includes(contact) || contact.length >= 3);
    const attachmentHit = isAttachment && phraseLower.match(/\b(pdf|file|doc|attachment)\b/);
    const appHit =
      (phraseLower.includes("whatsapp") && ref.appId === "whatsapp") ||
      (phraseLower.includes("gmail") && ref.appId === "gmail") ||
      (phraseLower.includes("email") && ref.appId === "gmail");

    if (!contactHit && !attachmentHit && !appHit && (ref.score ?? 0) < 0.35) {
      continue;
    }

    const url = refKeyUrl(ref.refKey);
    if (!url) continue;

    await openUrlInBrowser(url);
    return `Opened ${ref.appId ?? "app"} — ${ref.summary.slice(0, 100)}`;
  }

  return null;
}
