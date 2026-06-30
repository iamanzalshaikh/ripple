import { existsSync } from "node:fs";
import { appendActivityLog } from "./activityLog.js";
import { resolveContactForMemory } from "./recordFileTouch.js";
import { upsertSemanticIndex } from "./semanticIndex.js";
import { upsertSemanticRef } from "./semanticEmbeddings.js";

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
};

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
  }

  console.info(
    `[ripple-desktop] P8 cross-app ingest → ${args.appId} | ${summary.slice(0, 60)}${contact ? ` | ${contact}` : ""}`,
  );
}
