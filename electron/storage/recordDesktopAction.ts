import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { LastOpenedKind, MemoryKey } from "./sessionMemory.js";
import { appendDesktopHistory } from "./desktopHistory.js";
import { setMemory } from "./sessionMemory.js";
import { trackPathOpen } from "./autoAlias.js";
import { setCapabilityCacheEntry } from "./capabilityCache.js";
import { boostEntityFromOpen, boostAppFromLaunch } from "./knowledgeGraph.js";
import { recordTrustSignal } from "./actionTrust.js";
import { resolveFolderPath } from "../automation/desktop/openFolder.js";
import {
  appendActivityLog,
  summarizeActivity,
} from "./activityLog.js";
import { upsertSemanticIndex } from "./semanticIndex.js";

function spokenKeyFromCommand(command: string): string | null {
  const open = command.match(/\bopen\s+(?:my\s+|the\s+)?(.+?)\s*$/i);
  const launch = command.match(/\b(?:launch|start)\s+(?:my\s+|the\s+)?(.+?)\s*$/i);
  const key = (open?.[1] ?? launch?.[1])?.trim().toLowerCase();
  return key && key.length >= 2 ? key : null;
}

export function extractPathFromResult(result: string): string | null {
  const patterns = [
    /Opened file:\s*(.+)$/i,
    /Opened folder:\s*(.+)$/i,
    /Moved to\s+(.+)$/i,
    /Renamed to\s+(.+)$/i,
    /Created folder:\s*(.+)$/i,
    /Opened workspace:\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = result.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function rememberParentFolder(path: string): void {
  const parent = dirname(path);
  if (!parent || parent === path || !existsSync(parent)) return;
  setMemory("last_parent_folder", parent);
  console.info(`[ripple-desktop] memory last_parent → ${parent}`);
}

function rememberLastOpened(kind: LastOpenedKind, path: string): void {
  if (!path?.trim()) return;
  setMemory("last_opened_path", path.trim());
  setMemory("last_opened_kind", kind);
  console.info(`[ripple-desktop] memory last_opened → ${kind}: ${path}`);
}

function rememberLastPdf(path: string): void {
  if (!path?.trim() || !path.toLowerCase().endsWith(".pdf")) return;
  setMemory("last_pdf", path.trim());
  console.info(`[ripple-desktop] memory last_pdf → ${path}`);
}

/** Update session memory from a successful desktop action. */
export function updateMemoryFromDesktopAction(
  kind: string | undefined,
  data: Record<string, unknown> | undefined,
  result: string,
): void {
  const resolvedPath =
    typeof data?.resolvedPath === "string"
      ? data.resolvedPath
      : extractPathFromResult(result);

  try {
    switch (kind) {
      case "folder": {
        const folder =
          typeof data?.folder === "string" ? data.folder : "downloads";
        const folderPath = resolveFolderPath(folder);
        setMemory("last_folder", folderPath);
        rememberLastOpened("folder", folderPath);
        rememberParentFolder(folderPath);
        break;
      }
      case "file":
        if (resolvedPath && existsSync(resolvedPath)) {
          setMemory("last_file", resolvedPath);
          rememberLastOpened("file", resolvedPath);
          rememberLastPdf(resolvedPath);
        }
        break;
      case "item":
        if (resolvedPath && existsSync(resolvedPath)) {
          const st = statSync(resolvedPath);
          if (st.isDirectory()) {
            setMemory("last_folder", resolvedPath);
            setMemory("last_project", resolvedPath);
            rememberLastOpened("folder", resolvedPath);
            rememberParentFolder(resolvedPath);
          } else {
            setMemory("last_file", resolvedPath);
            rememberLastOpened("file", resolvedPath);
            rememberLastPdf(resolvedPath);
          }
        }
        break;
      case "smart_search":
        if (resolvedPath && existsSync(resolvedPath)) {
          const st = statSync(resolvedPath);
          if (st.isDirectory()) {
            setMemory("last_folder", resolvedPath);
            rememberLastOpened("folder", resolvedPath);
            rememberParentFolder(resolvedPath);
          } else {
            setMemory("last_file", resolvedPath);
            rememberLastOpened("file", resolvedPath);
            rememberLastPdf(resolvedPath);
          }
        }
        break;
      case "open_alias": {
        const aliasType = data?.aliasType;
        const aliasPath =
          typeof data?.aliasPath === "string" ? data.aliasPath : "";
        if (!aliasPath) break;
        if (aliasType === "file") {
          setMemory("last_file", aliasPath);
          rememberLastOpened("file", aliasPath);
          rememberLastPdf(aliasPath);
        } else if (aliasType === "workspace" || /^https?:\/\//i.test(aliasPath)) {
          setMemory("last_workspace", aliasPath);
          rememberLastOpened("workspace", aliasPath);
        } else {
          setMemory("last_folder", aliasPath);
          setMemory("last_project", aliasPath);
          rememberLastOpened("project", aliasPath);
        }
        break;
      }
      case "open_workspace": {
        const url =
          typeof data?.workspaceUrl === "string" ? data.workspaceUrl : "";
        if (url) {
          setMemory("last_workspace", url);
          rememberLastOpened("workspace", url);
        }
        break;
      }
      case "launch_app":
      case "switch_app": {
        const appId = typeof data?.appId === "string" ? data.appId : "";
        if (appId) {
          setMemory("last_app", appId);
          rememberLastOpened("app", appId);
        }
        break;
      }
      case "recall_memory":
        if (resolvedPath && existsSync(resolvedPath)) {
          const st = statSync(resolvedPath);
          rememberLastOpened(st.isDirectory() ? "folder" : "file", resolvedPath);
          if (!st.isDirectory()) rememberLastPdf(resolvedPath);
        }
        break;
      case "move_file":
      case "rename_file":
        if (resolvedPath && existsSync(resolvedPath)) {
          setMemory("last_file", resolvedPath);
          rememberLastOpened("file", resolvedPath);
          rememberLastPdf(resolvedPath);
        }
        break;
      default:
        break;
    }
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] memory update skipped:",
      e instanceof Error ? e.message : e,
    );
  }
}

export function recordDesktopActionOutcome(args: {
  command: string;
  intent?: string;
  result?: string;
  status: "ok" | "error";
  data?: Record<string, unknown>;
}): void {
  const resolvedPath =
    typeof args.data?.resolvedPath === "string"
      ? args.data.resolvedPath
      : extractPathFromResult(args.result ?? "");

  try {
    appendDesktopHistory({
      command: args.command,
      intent: args.intent ?? null,
      resolved_path: resolvedPath,
      entities_json: args.data?.desktopKind
        ? JSON.stringify({
            kind: args.data.desktopKind,
            folder: args.data.folder,
            itemName: args.data.itemName,
          })
        : null,
      result: args.result ?? null,
      status: args.status,
    });
    if (args.status === "ok" && args.result) {
      const kind =
        typeof args.data?.desktopKind === "string"
          ? args.data.desktopKind
          : undefined;
      updateMemoryFromDesktopAction(kind, args.data, args.result);
      if (kind === "launch_app") {
        const appId =
          typeof args.data?.appId === "string" ? args.data.appId : "";
        if (appId) {
          const key = spokenKeyFromCommand(args.command);
          boostAppFromLaunch(appId, key ?? undefined);
        }
      }
      if (resolvedPath) {
        trackPathOpen(resolvedPath, args.command);
        const key = spokenKeyFromCommand(args.command);
        if (key) {
          setCapabilityCacheEntry(key, resolvedPath, 0.99);
          boostEntityFromOpen(key, resolvedPath);
          recordTrustSignal(key, "success");
        }
        const contact =
          typeof args.data?.contact === "string" ? args.data.contact : undefined;
        const appId =
          typeof args.data?.appId === "string" ? args.data.appId : undefined;
        appendActivityLog({
          path: resolvedPath,
          app_id: appId,
          contact,
          command: args.command,
          summary: summarizeActivity(resolvedPath, args.command),
        });
        upsertSemanticIndex({
          path: resolvedPath,
          command: args.command,
          contact,
          appId,
        });
      }
    }
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] desktop history skipped:",
      e instanceof Error ? e.message : e,
    );
  }
}

export type { MemoryKey };
