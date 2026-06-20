import { basename } from "node:path";
import { getMemory, setMemory, type MemoryKey } from "./sessionMemory.js";
import { getAlias, resolveAlias } from "../automation/desktop/aliasRegistry.js";

/** Phase 4.6 — hot session context for referential NLU. */
export type LastCommandContext = {
  last_file: string | null;
  last_folder: string | null;
  last_project: string | null;
  last_contact: string | null;
  last_app: string | null;
  last_workspace: string | null;
};

export function getLastCommandContext(): LastCommandContext {
  return {
    last_file: getMemory("last_file"),
    last_folder: getMemory("last_folder"),
    last_project: getMemory("last_project"),
    last_contact: getMemory("last_contact"),
    last_app: getMemory("last_app"),
    last_workspace: getMemory("last_workspace"),
  };
}

export function rememberContact(name: string): void {
  const trimmed = name.trim();
  if (trimmed) {
    setMemory("last_contact", trimmed);
    console.info(`[ripple-desktop] memory last_contact → "${trimmed}"`);
  }
}

export function rememberFromKey(key: MemoryKey, value: string): void {
  if (value.trim()) setMemory(key, value.trim());
}

/** Resolve spoken file/folder name via alias then memory. */
export function resolveReferentialPath(
  token: "file" | "folder" | "project",
): string | null {
  const ctx = getLastCommandContext();
  if (token === "file") return ctx.last_file;
  if (token === "project") return ctx.last_project ?? ctx.last_folder;
  return ctx.last_folder ?? ctx.last_project;
}

export function spokenNameFromPath(path: string): string {
  const base = basename(path).replace(/\.[^.]+$/, "");
  return base.toLowerCase().replace(/[_-]+/g, " ").trim() || "item";
}

export function aliasForPath(path: string): string | null {
  const alias = resolveAlias(spokenNameFromPath(path));
  if (alias?.path === path) return alias.name;
  const direct = getAlias(spokenNameFromPath(path));
  if (direct?.path === path) return direct.name;
  return null;
}
