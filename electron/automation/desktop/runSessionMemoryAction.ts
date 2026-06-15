import { existsSync, statSync } from "node:fs";
import { openUrlInBrowser } from "../openUrl.js";
import { findNativeAppById } from "./nativeAppRegistry.js";
import { launchNativeApp } from "./launchApp.js";
import { openFile, openFolder } from "./openFolder.js";
import type { RecallTarget } from "./parseSessionMemoryCommand.js";
import { getMemory } from "../../storage/sessionMemory.js";
import { focusAppWindow } from "./windowManager.js";

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

export async function runRecallMemoryAction(
  target: RecallTarget,
): Promise<string> {
  const tryKeys: Array<{ key: Parameters<typeof getMemory>[0]; label: string }> =
    [];

  if (target === "file" || target === "auto") {
    tryKeys.push({ key: "last_file", label: "file" });
  }
  if (target === "folder" || target === "auto") {
    tryKeys.push({ key: "last_folder", label: "folder" });
    tryKeys.push({ key: "last_project", label: "project" });
  }
  if (target === "workspace" || target === "auto") {
    tryKeys.push({ key: "last_workspace", label: "workspace" });
  }
  if (target === "app" || target === "auto") {
    const appId = getMemory("last_app");
    if (appId) {
      const app = findNativeAppById(appId);
      if (app) {
        try {
          return await focusAppWindow(app);
        } catch {
          return launchNativeApp(app);
        }
      }
    }
  }

  for (const { key, label } of tryKeys) {
    const value = getMemory(key);
    if (!value) continue;

    if (key === "last_workspace" || /^https?:\/\//i.test(value)) {
      await openUrlInBrowser(value);
      return `Opened last workspace`;
    }

    return openLastPath(value, label);
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
