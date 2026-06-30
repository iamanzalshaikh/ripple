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
import { queryLatestByExtension } from "../../storage/fileIndex.js";
import { focusAppWindow } from "./windowManager.js";
import {
  getFocusContext,
  refreshFocusFromExtension,
} from "../../focus/focusContext.js";
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "./mediaFocusMemory.js";
import { resolveLastOpenedByKind } from "./p8RecallResolver.js";
import type { OpenedItemKind } from "./openedPathKind.js";

function newestExistingByExtensions(extensions: string[]): string | null {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const ext of extensions) {
    for (const path of queryLatestByExtension(ext, 20)) {
      const key = path.toLowerCase();
      if (seen.has(key) || !existsSync(path)) continue;
      seen.add(key);
      candidates.push(path);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

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
  if (target === "video" || target === "image") return kind === "file";
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

const TARGET_TO_KIND: Partial<Record<RecallTarget, OpenedItemKind>> = {
  pdf: "pdf",
  image: "image",
  video: "video",
  folder: "folder",
  file: "file",
};

async function recallByP8Kind(
  kind: OpenedItemKind,
  label: string,
): Promise<string> {
  await refreshFocusFromExtension();
  const ctx = getFocusContext();
  const path = await resolveLastOpenedByKind(kind, ctx);
  if (path) {
    console.info(`[ripple-desktop] recall (${label}) → ${path}`);
    return openLastPath(path, label);
  }
  if (kind === "video") {
    const fallback = newestExistingByExtensions(VIDEO_EXTENSIONS);
    if (fallback) {
      console.info(`[ripple-desktop] recall (video) → indexed: ${fallback}`);
      return openLastPath(fallback, "video");
    }
  }
  if (kind === "image") {
    const fallback = newestExistingByExtensions(IMAGE_EXTENSIONS);
    if (fallback) {
      console.info(`[ripple-desktop] recall (image) → indexed: ${fallback}`);
      return openLastPath(fallback, "image");
    }
  }
  throw new Error(
    `No ${label} opened yet — open a ${label} first, then say "open last ${label}"`,
  );
}

export async function runRecallMemoryAction(
  target: RecallTarget,
): Promise<string> {
  const p8Kind = TARGET_TO_KIND[target];
  if (p8Kind) {
    return recallByP8Kind(p8Kind, target);
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

  if (target === "workspace") {
    const url = getMemory("last_workspace");
    if (url) {
      await openUrlInBrowser(url);
      return "Opened last workspace";
    }
  } else if (target === "app") {
    const appId = getMemory("last_app");
    if (appId) {
      return openLastApp(appId);
    }
  } else if (target === "auto") {
    await refreshFocusFromExtension();
    const ctx = getFocusContext();
    for (const kind of [
      "folder",
      "file",
      "pdf",
      "image",
      "video",
    ] as OpenedItemKind[]) {
      const path = await resolveLastOpenedByKind(kind, ctx);
      if (!path) continue;
      console.info(`[ripple-desktop] recall (auto) → last ${kind}`);
      return openLastPath(path, kind);
    }
    const appId = getMemory("last_app");
    if (appId) {
      try {
        return await openLastApp(appId);
      } catch {
        /* fall through */
      }
    }
    const workspace = getMemory("last_workspace");
    if (workspace) {
      await openUrlInBrowser(workspace);
      return "Opened last workspace";
    }
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
