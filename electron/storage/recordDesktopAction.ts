import { existsSync, statSync } from "node:fs";
import type { MemoryKey } from "./sessionMemory.js";
import { appendDesktopHistory } from "./desktopHistory.js";
import { setMemory } from "./sessionMemory.js";
import { resolveFolderPath } from "../automation/desktop/openFolder.js";

function extractPathFromResult(result: string): string | null {
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
        setMemory("last_folder", resolveFolderPath(folder));
        break;
      }
      case "file":
        if (resolvedPath && existsSync(resolvedPath)) {
          setMemory("last_file", resolvedPath);
        }
        break;
      case "item":
        if (resolvedPath && existsSync(resolvedPath)) {
          const st = statSync(resolvedPath);
          if (st.isDirectory()) {
            setMemory("last_folder", resolvedPath);
          } else {
            setMemory("last_file", resolvedPath);
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
        } else if (aliasType === "workspace" || /^https?:\/\//i.test(aliasPath)) {
          setMemory("last_workspace", aliasPath);
        } else {
          setMemory("last_folder", aliasPath);
          setMemory("last_project", aliasPath);
        }
        break;
      }
      case "open_workspace": {
        const url =
          typeof data?.workspaceUrl === "string" ? data.workspaceUrl : "";
        if (url) setMemory("last_workspace", url);
        break;
      }
      case "launch_app": {
        const appId = typeof data?.appId === "string" ? data.appId : "";
        if (appId) setMemory("last_app", appId);
        break;
      }
      case "move_file":
      case "rename_file":
        if (resolvedPath && existsSync(resolvedPath)) {
          setMemory("last_file", resolvedPath);
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
  try {
    appendDesktopHistory({
      command: args.command,
      intent: args.intent ?? null,
      result: args.result ?? null,
      status: args.status,
    });
    if (args.status === "ok" && args.result) {
      const kind =
        typeof args.data?.desktopKind === "string"
          ? args.data.desktopKind
          : undefined;
      updateMemoryFromDesktopAction(kind, args.data, args.result);
    }
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] desktop history skipped:",
      e instanceof Error ? e.message : e,
    );
  }
}

export type { MemoryKey };
