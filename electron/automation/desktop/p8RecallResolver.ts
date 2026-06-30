import { existsSync } from "node:fs";
import type { FocusContext } from "../../focus/focusContext.js";
import { searchRecentOpenedPathsByKind } from "../../storage/activityLog.js";
import { searchRecentDesktopHistoryPathsByKind } from "../../storage/desktopHistory.js";
import { getMemory } from "../../storage/sessionMemory.js";
import { resolveExplorerFolderFromTitle } from "./folderFocusMemory.js";
import {
  extractMediaNameFromWindowTitle,
  extractMediaPathFromUrl,
  findMediaOnDiskAsync,
  FOCUS_TRUST_MS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "./mediaFocusMemory.js";
import type { OpenedItemKind } from "./openedPathKind.js";
import { pathMatchesOpenedKind } from "./openedPathKind.js";
import {
  extractPdfNameFromWindowTitle,
  extractPdfPathFromUrl,
  findPdfOnDiskAsync,
} from "./pdfFocusMemory.js";

/** P8 — scan depth for months of activity (SQLite retains all rows). */
const LONG_TERM_SCAN = 800;

const SESSION_KEY: Record<
  OpenedItemKind,
  "last_pdf" | "last_image" | "last_video" | "last_folder" | "last_file"
> = {
  pdf: "last_pdf",
  image: "last_image",
  video: "last_video",
  folder: "last_folder",
  file: "last_file",
};

function firstExisting(paths: Iterable<string>): string | null {
  for (const path of paths) {
    if (existsSync(path)) return path;
  }
  return null;
}

function resolveFromLongTermStore(kind: OpenedItemKind): string | null {
  const fromActivity = searchRecentOpenedPathsByKind(kind, LONG_TERM_SCAN);
  const hit = firstExisting(fromActivity);
  if (hit) return hit;

  const fromHistory = searchRecentDesktopHistoryPathsByKind(
    kind,
    LONG_TERM_SCAN,
  );
  return firstExisting(fromHistory);
}

function resolveFromSessionMemory(kind: OpenedItemKind): string | null {
  const key = SESSION_KEY[kind];
  const path = getMemory(key);
  if (path && existsSync(path) && pathMatchesOpenedKind(path, kind)) {
    return path;
  }
  if (kind === "folder") {
    const project = getMemory("last_project");
    if (project && existsSync(project) && pathMatchesOpenedKind(project, kind)) {
      return project;
    }
  }
  return null;
}

async function resolveFromFreshFocus(
  kind: OpenedItemKind,
  ctx: FocusContext | null,
): Promise<string | null> {
  if (!ctx || Date.now() - ctx.capturedAt > FOCUS_TRUST_MS) return null;

  if (kind === "pdf") {
    const fromUrl = extractPdfPathFromUrl(ctx.activeTabUrl);
    if (fromUrl) return fromUrl;
    const name = extractPdfNameFromWindowTitle(ctx.windowTitle);
    return name ? findPdfOnDiskAsync(name) : null;
  }

  if (kind === "image" || kind === "video") {
    const exts = kind === "image" ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
    const fromUrl = extractMediaPathFromUrl(ctx.activeTabUrl);
    if (fromUrl && pathMatchesOpenedKind(fromUrl, kind)) return fromUrl;
    const name = extractMediaNameFromWindowTitle(ctx.windowTitle);
    return name ? findMediaOnDiskAsync(name, exts) : null;
  }

  if (kind === "folder" && ctx.processName.toLowerCase() === "explorer") {
    return resolveExplorerFolderFromTitle(ctx.windowTitle);
  }

  return null;
}

/**
 * P8 unified recall — activity_log + desktop_history (months of context),
 * then fresh focus, then session keys. Closing/cutting a file does not erase memory.
 */
export async function resolveLastOpenedByKind(
  kind: OpenedItemKind,
  ctx: FocusContext | null,
): Promise<string | null> {
  const fromStore = resolveFromLongTermStore(kind);
  if (fromStore) return fromStore;

  const fromFocus = await resolveFromFreshFocus(kind, ctx);
  if (fromFocus && pathMatchesOpenedKind(fromFocus, kind)) {
    return fromFocus;
  }

  return resolveFromSessionMemory(kind);
}
