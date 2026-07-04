import { existsSync } from "node:fs";
import { basename } from "node:path";
import { openSmartSearchResult } from "../desktop/intelligentSearch.js";
import { searchCrossAppAttachmentPaths } from "../../storage/activityLog.js";
import { searchPathVectorIndex } from "../../storage/sqliteVec.js";
import { searchSemanticRefs } from "../../storage/semanticEmbeddings.js";
import { tryOpenCrossAppSemanticRef } from "./openCrossAppRef.js";

function isAttachmentPath(path: string): boolean {
  const lower = path.toLowerCase().replace(/\\/g, "/");
  return (
    lower.includes("/ripple/attachments/") ||
    lower.includes("/downloads/ripple/attachments/")
  );
}

function pathMatchesExtension(path: string, ext?: string): boolean {
  if (!ext) return true;
  const e = ext.trim().toLowerCase().replace(/^\./, "");
  return path.toLowerCase().endsWith(`.${e}`);
}

/** Open a downloaded cross-app attachment from activity_log / vector index. */
export async function tryOpenCrossAppAttachmentFile(
  phrase: string,
  options?: { extension?: string; contact?: string },
): Promise<string | null> {
  const ext = options?.extension?.trim().toLowerCase();
  const contact = options?.contact?.trim().toLowerCase();

  const activityPaths = searchCrossAppAttachmentPaths(phrase, {
    extension: ext,
    contact,
    limit: 10,
  });
  for (const path of activityPaths) {
    if (existsSync(path)) {
      return openSmartSearchResult(path);
    }
  }

  const vectorHits = searchPathVectorIndex(phrase, 20);
  for (const hit of vectorHits) {
    const path = hit.id;
    if (!existsSync(path) || !isAttachmentPath(path)) continue;
    if (!pathMatchesExtension(path, ext)) continue;
    if (contact) {
      const base = basename(path).toLowerCase();
      if (!base.includes(contact) && hit.score < 0.4) continue;
    }
    return openSmartSearchResult(path);
  }

  const refs = searchSemanticRefs(phrase, 12);
  for (const ref of refs) {
    if (!ref.summary.toLowerCase().includes("attachment:")) continue;
    const refPaths = searchCrossAppAttachmentPaths(
      [phrase, ref.contact ?? "", ref.summary].join(" "),
      { extension: ext, contact: ref.contact ?? contact, limit: 4 },
    );
    for (const path of refPaths) {
      if (existsSync(path)) {
        return openSmartSearchResult(path);
      }
    }
  }

  return null;
}

/** Local file first, then cross-app thread URL fallback. */
export async function openCrossAppAttachment(
  phrase: string,
  options?: { extension?: string; contact?: string },
): Promise<string> {
  const local = await tryOpenCrossAppAttachmentFile(phrase, options);
  if (local) return local;

  const crossApp = await tryOpenCrossAppSemanticRef(phrase);
  if (crossApp) return crossApp;

  throw new Error(
    `No downloaded attachment found for "${phrase.trim()}" — open the email thread in Gmail first`,
  );
}
