import { existsSync } from "node:fs";
import { basename } from "node:path";
import { appendActivityLog } from "./activityLog.js";
import { resolveContactForMemory } from "./recordFileTouch.js";
import { upsertSemanticIndex } from "./semanticIndex.js";
import { upsertSemanticRef, upsertPathEmbedding } from "./semanticEmbeddings.js";

export type CrossAppId =
  | "gmail"
  | "slack"
  | "email"
  | "whatsapp"
  | "teams"
  | "outlook";

export type CrossAppIngestArgs = {
  appId: CrossAppId;
  summary: string;
  path?: string | null;
  contact?: string | null;
  command?: string | null;
  externalUrl?: string | null;
  attachments?: string[] | null;
};

function ingestAttachmentRefs(args: {
  appId: CrossAppId;
  attachments: string[];
  contact: string | null;
  baseSummary: string;
  externalUrl?: string | null;
  command?: string | null;
  path?: string | null;
}): void {
  const localPath = args.path?.trim() ?? null;
  const localBase = localPath ? basename(localPath).toLowerCase() : "";

  for (const rawName of args.attachments.slice(0, 8)) {
    const fileName = rawName.trim().slice(0, 120);
    if (!fileName) continue;
    const attSummary = [
      `Attachment: ${fileName}`,
      args.baseSummary,
      args.contact ? `from ${args.contact}` : "",
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 500);
    const refKey = args.externalUrl
      ? `${args.externalUrl}|${fileName.toLowerCase()}`
      : undefined;
    upsertSemanticRef({
      appId: args.appId,
      contact: args.contact,
      summary: attSummary,
      refKey,
    });

    if (
      localPath &&
      existsSync(localPath) &&
      localBase.includes(fileName.toLowerCase())
    ) {
      upsertSemanticIndex({
        path: localPath,
        command: args.command ?? attSummary,
        contact: args.contact ?? undefined,
        appId: args.appId,
      });
      upsertPathEmbedding(localPath, attSummary);
    }
  }
}

/**
 * P8b — record a file/reference seen in email, Slack, etc.
 * Extension bridge or manual IPC can call this.
 */
export function ingestCrossAppReference(args: CrossAppIngestArgs): void {
  const summary = args.summary.trim().slice(0, 500);
  if (!summary) return;

  const contact = resolveContactForMemory(args.contact, args.command);
  const path = args.path?.trim() ?? null;
  const command =
    args.command?.trim() ||
    `${args.appId}: ${summary}`.slice(0, 2000);

  appendActivityLog({
    path: path && existsSync(path) ? path : null,
    app_id: args.appId,
    contact: contact ?? null,
    command,
    summary,
  });

  upsertSemanticRef({
    appId: args.appId,
    contact: contact ?? null,
    summary,
    refKey: args.externalUrl?.trim() || undefined,
  });

  if (path && existsSync(path)) {
    upsertSemanticIndex({
      path,
      command,
      contact: contact ?? undefined,
      appId: args.appId,
    });
    upsertPathEmbedding(path, summary);
  }

  const attachments = (args.attachments ?? [])
    .map((a) => a.trim())
    .filter((a) => a.length >= 3);
  if (attachments.length > 0) {
    ingestAttachmentRefs({
      appId: args.appId,
      attachments,
      contact: contact ?? null,
      baseSummary: summary,
      externalUrl: args.externalUrl,
      command,
      path,
    });
  }

  const attNote =
    attachments.length > 0 ? ` (+${attachments.length} attachment(s))` : "";
  console.info(
    `[ripple-desktop] P8 cross-app ingest → ${args.appId} | ${summary.slice(0, 60)}${contact ? ` | ${contact}` : ""}${attNote}`,
  );
}
