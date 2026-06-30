import { existsSync, statSync } from "node:fs";
import { extractContactName } from "../automation/adapters/whatsapp/parseContact.js";
import { resolveReferentialContact } from "../automation/voice/nlu/parseReferentialWhatsApp.js";
import {
  appendActivityLog,
  summarizeActivity,
} from "./activityLog.js";
import { getLastCommandContext } from "./lastCommandState.js";
import { getRippleDb } from "./rippleDb.js";
import { upsertSemanticIndex } from "./semanticIndex.js";

export type FileTouchSource =
  | "open"
  | "send"
  | "retriever"
  | "file_index"
  | "clarify"
  | "copy"
  | "move"
  | "create"
  | "workspace";

const ACTIVITY_SOURCES = new Set<FileTouchSource>([
  "open",
  "send",
  "clarify",
  "copy",
  "move",
  "create",
  "workspace",
]);

export type RecordFileTouchArgs = {
  path: string;
  command?: string;
  contact?: string;
  appId?: string;
  source: FileTouchSource;
  /** When omitted, activity is logged for user-facing touches only. */
  logActivity?: boolean;
};

export function shouldLogActivity(source: FileTouchSource, override?: boolean): boolean {
  if (override !== undefined) return override;
  return ACTIVITY_SOURCES.has(source);
}

/** Normalize contact for activity_log + semantic_index (pronouns → last contact). */
export function resolveContactForMemory(
  contact?: string | null,
  command?: string | null,
): string | undefined {
  const raw = contact?.trim();
  if (raw) {
    const resolved = resolveReferentialContact(
      raw,
      getLastCommandContext().last_contact,
    );
    if (resolved) return resolved.toLowerCase();
  }

  const fromCommand = extractContactName(command);
  return fromCommand?.trim().toLowerCase() || undefined;
}

function isIndexablePath(path: string): boolean {
  if (!path?.trim() || !existsSync(path)) return false;
  try {
    const st = statSync(path);
    return st.isFile() || st.isDirectory();
  } catch {
    return false;
  }
}

/** P8 — upsert semantic profile (+ optional activity) whenever a path is touched. */
export function recordFileTouch(args: RecordFileTouchArgs): void {
  const path = args.path.trim();
  if (!isIndexablePath(path)) return;

  try {
    upsertSemanticIndex({
      path,
      command: args.command,
      contact: args.contact,
      appId: args.appId,
    });
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] semantic index touch skipped:",
      e instanceof Error ? e.message : e,
    );
  }

  if (!shouldLogActivity(args.source, args.logActivity)) return;

  try {
    appendActivityLog({
      path,
      app_id: args.appId ?? null,
      contact: args.contact ?? null,
      command: args.command?.slice(0, 2000) ?? `touched:${args.source}`,
      summary: summarizeActivity(
        path,
        args.command ?? `touched via ${args.source}`,
      ),
    });
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] activity log touch skipped:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** P8 — link a sent file to a WhatsApp contact in semantic + activity memory. */
export function recordWhatsAppSendTouch(args: {
  path: string;
  contact?: string | null;
  command?: string;
}): void {
  const path = args.path.trim();
  if (!path) return;

  const contact = resolveContactForMemory(args.contact, args.command);
  const command =
    args.command?.trim() ||
    (contact ? `sent to ${contact}` : "whatsapp send");

  recordFileTouch({
    path,
    command,
    contact,
    appId: "whatsapp",
    source: "send",
  });
}

/** Resolve disk path + contact from a desktop batch payload. */
export function touchPathFromDesktopData(
  data: Record<string, unknown> | undefined,
  command: string,
  kind?: string,
): void {
  const path =
    (typeof data?.resolvedPath === "string" && data.resolvedPath.trim()) ||
    (typeof data?.sourcePath === "string" && data.sourcePath.trim()) ||
    "";
  if (!path) return;

  const isSend = kind === "referential_send";
  const contact = resolveContactForMemory(
    typeof data?.contact === "string" ? data.contact : null,
    command,
  );

  recordFileTouch({
    path,
    command,
    contact,
    appId: isSend || contact ? "whatsapp" : undefined,
    source: isSend ? "send" : "open",
  });
}

export function recordFileTouches(
  paths: Iterable<string>,
  args: Omit<RecordFileTouchArgs, "path">,
): void {
  for (const path of paths) {
    recordFileTouch({ ...args, path });
  }
}

const DEFAULT_BACKFILL_LIMIT = 2000;

/** Index recent file_index rows missing or stale in semantic_index. */
export function backfillSemanticIndexFromFileIndex(
  limit = DEFAULT_BACKFILL_LIMIT,
): number {
  getRippleDb();

  const rows = getRippleDb()
    .prepare(
      `SELECT fi.path
       FROM file_index fi
       LEFT JOIN semantic_index si ON fi.path = si.path
       WHERE si.path IS NULL OR fi.modified_at > si.mtime
       ORDER BY fi.modified_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ path: string }>;

  let indexed = 0;
  for (const row of rows) {
    if (!isIndexablePath(row.path)) continue;
    try {
      upsertSemanticIndex({ path: row.path, command: "file_index backfill" });
      indexed++;
    } catch {
      /* skip single path */
    }
  }
  return indexed;
}

/** Run after file_index background build — fills semantic_index for existing files. */
export function startSemanticIndexBackfill(): void {
  setTimeout(() => {
    try {
      const count = backfillSemanticIndexFromFileIndex();
      if (count > 0) {
        console.info(
          `[ripple-desktop] P8 semantic backfill → ${count} path(s) indexed`,
        );
      }
    } catch (e: unknown) {
      console.warn(
        "[ripple-desktop] semantic backfill failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }, 10_000);
}
