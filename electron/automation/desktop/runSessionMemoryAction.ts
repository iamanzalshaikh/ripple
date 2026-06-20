import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { openUrlInBrowser } from "../openUrl.js";
import { findNativeAppById } from "./nativeAppRegistry.js";
import { launchNativeApp } from "./launchApp.js";
import { openFile, openFolder } from "./openFolder.js";
import type { RecallTarget } from "./parseSessionMemoryCommand.js";
import { getMemory } from "../../storage/sessionMemory.js";
import type { LastOpenedKind } from "../../storage/sessionMemory.js";
import { getLastSuccessfulOpen } from "../../storage/desktopHistory.js";
import { focusAppWindow } from "./windowManager.js";
import { getFocusContext } from "../../focus/focusContext.js";

function parentFromExplorerFocus(): string | null {
  const ctx = getFocusContext();
  if (!ctx || ctx.processName.toLowerCase() !== "explorer") return null;

  const folderName = ctx.windowTitle
    .replace(/\s*-\s*File Explorer\s*$/i, "")
    .trim();
  if (!folderName) return null;

  const wellKnown: Record<string, string> = {
    downloads: join(homedir(), "Downloads"),
    documents: join(homedir(), "Documents"),
    desktop: join(homedir(), "Desktop"),
  };
  const lower = folderName.toLowerCase();
  if (wellKnown[lower]) {
    return homedir();
  }

  for (const root of Object.values(wellKnown)) {
    const candidate = join(root, folderName);
    if (existsSync(candidate)) {
      return root;
    }
  }

  return null;
}

async function openLastPath(path: string, label: string): Promise<string> {
  if (!existsSync(path)) {
    throw new Error(`Last ${label} no longer exists: ${path}`);
  }
  const st = statSync(path);
  if (st.isDirectory()) {
    return openFolder(path);
  }
  return openFile(path);
}

async function openLastApp(appId: string): Promise<string> {
  const app = findNativeAppById(appId);
  if (!app) {
    throw new Error(`Last app "${appId}" is not installed anymore`);
  }
  try {
    return await focusAppWindow(app);
  } catch {
    return launchNativeApp(app);
  }
}

function kindMatchesTarget(kind: LastOpenedKind, target: RecallTarget): boolean {
  if (target === "auto" || target === "parent") return true;
  if (target === "folder") return kind === "folder" || kind === "project";
  if (target === "file") return kind === "file";
  if (target === "workspace") return kind === "workspace";
  if (target === "app") return kind === "app";
  return false;
}

async function tryLastOpened(target: RecallTarget): Promise<string | null> {
  const path = getMemory("last_opened_path");
  const kind = getMemory("last_opened_kind") as LastOpenedKind | null;
  if (!path || !kind || !kindMatchesTarget(kind, target)) return null;

  if (kind === "app") {
    return openLastApp(path);
  }
  if (kind === "workspace" || /^https?:\/\//i.test(path)) {
    await openUrlInBrowser(path);
    return "Opened last workspace";
  }
  return openLastPath(path, kind);
}

export async function runRecallMemoryAction(
  target: RecallTarget,
): Promise<string> {
  if (target === "pdf") {
    const pdf = getMemory("last_pdf");
    if (pdf) {
      console.info(`[ripple-desktop] recall (pdf) → last_pdf`);
      return openLastPath(pdf, "pdf");
    }
    throw new Error(
      'No PDF opened yet — open a PDF first, then say "open last pdf"',
    );
  }

  if (target === "parent") {
    const parent =
      getMemory("last_parent_folder") ??
      (() => {
        const current = getMemory("last_opened_path");
        return current ? dirname(current) : null;
      })() ??
      parentFromExplorerFocus();
    if (!parent || !existsSync(parent)) {
      throw new Error(
        'No parent folder — open a subfolder first, then say "go back"',
      );
    }
    console.info(`[ripple-desktop] recall (parent) → ${parent}`);
    return openLastPath(parent, "parent folder");
  }

  const fromLastOpened = await tryLastOpened(target);
  if (fromLastOpened) {
    console.info(`[ripple-desktop] recall (${target}) → last_opened`);
    return fromLastOpened;
  }

  const tryKeys: Array<{ key: Parameters<typeof getMemory>[0]; label: string }> =
    [];

  if (target === "file") {
    tryKeys.push({ key: "last_file", label: "file" });
  } else if (target === "folder") {
    tryKeys.push({ key: "last_project", label: "project" });
    tryKeys.push({ key: "last_folder", label: "folder" });
  } else if (target === "workspace") {
    tryKeys.push({ key: "last_workspace", label: "workspace" });
  } else if (target === "app") {
    const appId = getMemory("last_app");
    if (appId) {
      return openLastApp(appId);
    }
  } else {
    // auto — prefer folder/project then file (most users reopen folders)
    tryKeys.push({ key: "last_project", label: "project" });
    tryKeys.push({ key: "last_folder", label: "folder" });
    tryKeys.push({ key: "last_file", label: "file" });
    tryKeys.push({ key: "last_workspace", label: "workspace" });
    const appId = getMemory("last_app");
    if (appId) {
      try {
        return await openLastApp(appId);
      } catch {
        /* try path keys next */
      }
    }
  }

  for (const { key, label } of tryKeys) {
    const value = getMemory(key);
    if (!value) continue;

    if (key === "last_workspace" || /^https?:\/\//i.test(value)) {
      await openUrlInBrowser(value);
      return "Opened last workspace";
    }

    console.info(`[ripple-desktop] recall (${target}) → ${key}`);
    return openLastPath(value, label);
  }

  const history = getLastSuccessfulOpen();
  if (history?.resolved_path && existsSync(history.resolved_path)) {
    console.info(
      `[ripple-desktop] recall (${target}) → history: ${history.resolved_path}`,
    );
    return openLastPath(history.resolved_path, "item");
  }

  if (target === "file") {
    const folder = getMemory("last_folder");
    if (folder) {
      throw new Error(
        'No last file yet — you opened a folder last. Say "open it again" or open a file first.',
      );
    }
  }

  throw new Error(
    'Nothing to reopen yet — open a file or folder first, then say "open it again"',
  );
}
