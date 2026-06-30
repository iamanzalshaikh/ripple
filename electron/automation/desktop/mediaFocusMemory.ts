import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { FocusContext } from "../../focus/focusContext.js";
import { searchIndexByName } from "../../storage/fileIndex.js";
import {
  searchRecentOpenedPathsByExtensions,
} from "../../storage/activityLog.js";
import {
  searchRecentDesktopHistoryPathsByExtensions,
} from "../../storage/desktopHistory.js";
import { getMemory, setMemory } from "../../storage/sessionMemory.js";
import { recordFileTouch } from "../../storage/recordFileTouch.js";
import { retrieveFileCandidates } from "../retriever/retriever.js";

const VIEWED_MEDIA_TTL_MS = 45 * 60 * 1000;
/** Only trust focus window title when capture is this recent (avoids stale 2nd-last image). */
export const FOCUS_TRUST_MS = 20_000;

export const VIDEO_EXTENSIONS = [
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "webm",
  "m4v",
  "3gp",
  "mpeg",
  "mpg",
];

export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
  "heic",
];

const VIDEO_EXT_RE =
  /\.(?:mp4|mkv|avi|mov|wmv|webm|m4v|3gp|mpeg|mpg)$/i;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif|bmp|svg|heic)$/i;
const MEDIA_EXT_RE =
  /\.(?:mp4|mkv|avi|mov|wmv|webm|m4v|3gp|mpeg|mpg|png|jpe?g|webp|gif|bmp|svg|heic)$/i;

function extensionOf(path: string): string | null {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? null;
}

function matchesExtensions(path: string, extensions: string[]): boolean {
  const ext = extensionOf(path);
  if (!ext) return false;
  return extensions.includes(ext);
}

/** Extract `Screen Recording.mp4` from Photos / Media Player / Explorer titles. */
export function extractMediaNameFromWindowTitle(title: string): string | null {
  const t = title.trim();
  if (!t) return null;

  const patterns = [
    /([^\\/|"\n]+\.(?:mp4|mkv|avi|mov|wmv|webm|m4v|3gp|mpeg|mpg|png|jpe?g|webp|gif|bmp|svg|heic))\s*[-|–]\s+/i,
    /([^\\/|"\n]+\.(?:mp4|mkv|avi|mov|wmv|webm|m4v|3gp|mpeg|mpg|png|jpe?g|webp|gif|bmp|svg|heic))\s*$/i,
    /^([^\\/|"\n]+\.(?:mp4|mkv|avi|mov|wmv|webm|m4v|3gp|mpeg|mpg|png|jpe?g|webp|gif|bmp|svg|heic))$/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  return null;
}

export function extractMediaPathFromUrl(url?: string): string | null {
  if (!url?.trim()) return null;
  const raw = url.trim();
  if (!/^file:/i.test(raw)) return null;

  try {
    const decoded = decodeURIComponent(raw.replace(/^file:\/+/, ""));
    const path = decoded.replace(/\//g, "\\");
    if (MEDIA_EXT_RE.test(path) && existsSync(path)) {
      return path;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isMediaViewerContext(ctx: FocusContext): boolean {
  if (extractMediaPathFromUrl(ctx.activeTabUrl)) return true;
  if (extractMediaNameFromWindowTitle(ctx.windowTitle)) return true;

  const p = ctx.processName.toLowerCase();
  if (
    p.includes("photos") ||
    p.includes("movies") ||
    p.includes("films") ||
    p.includes("vlc") ||
    p.includes("wmplayer") ||
    p.includes("clipchamp")
  ) {
    return MEDIA_EXT_RE.test(ctx.windowTitle);
  }

  return false;
}

function rememberViewedVideo(path: string, source: string): void {
  const normalized = path.trim();
  if (!VIDEO_EXT_RE.test(normalized)) return;

  const prev = getMemory("last_viewed_video");
  const now = String(Date.now());
  setMemory("last_viewed_video", normalized);
  setMemory("last_viewed_video_at", now);
  setMemory("last_video", normalized);
  setMemory("last_file", normalized);
  setMemory("last_opened_path", normalized);
  setMemory("last_opened_kind", "file");
  if (prev !== normalized) {
    recordFileTouch({
      path: normalized,
      command: `viewed video (${source})`,
      source: "open",
    });
  }
  console.info(
    `[ripple-desktop] memory last_viewed_video (${source}) → ${normalized}`,
  );
}

function rememberViewedImage(path: string, source: string): void {
  const normalized = path.trim();
  if (!IMAGE_EXT_RE.test(normalized)) return;

  const prev = getMemory("last_viewed_image");
  const now = String(Date.now());
  setMemory("last_viewed_image", normalized);
  setMemory("last_viewed_image_at", now);
  setMemory("last_image", normalized);
  setMemory("last_file", normalized);
  setMemory("last_opened_path", normalized);
  setMemory("last_opened_kind", "file");
  if (prev !== normalized) {
    recordFileTouch({
      path: normalized,
      command: `viewed image (${source})`,
      source: "open",
    });
  }
  console.info(
    `[ripple-desktop] memory last_viewed_image (${source}) → ${normalized}`,
  );
}

function pickBestMediaMatch(
  candidates: string[],
  mediaName: string,
): string | null {
  const want = mediaName.toLowerCase();
  const exact = candidates.find(
    (p) => basename(p).toLowerCase() === want,
  );
  if (exact) return exact;

  const stem = want.replace(/\.[a-z0-9]+$/i, "");
  const partial = candidates.find((p) => {
    const base = basename(p).toLowerCase();
    return (
      base.includes(stem) ||
      stem.includes(base.replace(/\.[a-z0-9]+$/i, ""))
    );
  });
  return partial ?? candidates[0] ?? null;
}

export function findMediaOnDiskSync(mediaName: string): string | null {
  const token = mediaName.replace(/\.[a-z0-9]+$/i, "").trim();
  if (!token) return null;

  const indexed = searchIndexByName(token);
  const fromIndex = pickBestMediaMatch(indexed, mediaName);
  if (fromIndex && existsSync(fromIndex)) return fromIndex;

  const indexedFull = searchIndexByName(mediaName);
  const fromFull = pickBestMediaMatch(indexedFull, mediaName);
  if (fromFull && existsSync(fromFull)) return fromFull;

  return null;
}

export async function findMediaOnDiskAsync(
  mediaName: string,
  extensions: string[],
): Promise<string | null> {
  const sync = findMediaOnDiskSync(mediaName);
  if (sync) return sync;

  const token = mediaName.replace(/\.[a-z0-9]+$/i, "").trim();
  const ext = extensionOf(mediaName) ?? extensions[0];
  const candidates = await retrieveFileCandidates({
    phrase: mediaName,
    token,
    extension: ext,
  });

  const paths = candidates
    .map((c) => c.path)
    .filter((p) => matchesExtensions(p, extensions));
  const picked = pickBestMediaMatch(paths, mediaName);
  return picked && existsSync(picked) ? picked : null;
}

async function resolveAndRememberMedia(
  mediaName: string,
  extensions: string[],
  kind: "video" | "image",
): Promise<void> {
  const path = await findMediaOnDiskAsync(mediaName, extensions);
  if (!path) return;

  if (kind === "video") {
    setMemory("last_viewed_video_title", mediaName);
    rememberViewedVideo(path, "resolved");
  } else {
    setMemory("last_viewed_image_title", mediaName);
    rememberViewedImage(path, "resolved");
  }
}

/** Update session memory when user views an image/video in Photos / player / browser. */
export function rememberMediaFromFocus(ctx: FocusContext): void {
  if (!isMediaViewerContext(ctx)) return;

  const fromUrl = extractMediaPathFromUrl(ctx.activeTabUrl);
  if (fromUrl) {
    if (VIDEO_EXT_RE.test(fromUrl)) {
      rememberViewedVideo(fromUrl, "focus-url");
    } else if (IMAGE_EXT_RE.test(fromUrl)) {
      rememberViewedImage(fromUrl, "focus-url");
    }
    return;
  }

  const mediaName = extractMediaNameFromWindowTitle(ctx.windowTitle);
  if (!mediaName) return;

  const isVideo = VIDEO_EXT_RE.test(mediaName);
  const isImage = IMAGE_EXT_RE.test(mediaName);
  if (!isVideo && !isImage) return;

  const now = String(Date.now());
  if (isVideo) {
    setMemory("last_viewed_video_title", mediaName);
    setMemory("last_viewed_video_at", now);
  } else {
    setMemory("last_viewed_image_title", mediaName);
    setMemory("last_viewed_image_at", now);
  }

  const sync = findMediaOnDiskSync(mediaName);
  if (sync) {
    if (isVideo) rememberViewedVideo(sync, "focus-title");
    else rememberViewedImage(sync, "focus-title");
    return;
  }

  void resolveAndRememberMedia(
    mediaName,
    isVideo ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS,
    isVideo ? "video" : "image",
  );
}

function isViewedMediaFresh(atKey: MemoryAtKey): boolean {
  const at = Number(getMemory(atKey) ?? "0");
  return at > 0 && Date.now() - at < VIEWED_MEDIA_TTL_MS;
}

type MemoryAtKey = "last_viewed_video_at" | "last_viewed_image_at";

async function resolveFromFocusTitle(
  ctx: FocusContext | null,
  extensions: string[],
): Promise<string | null> {
  if (!ctx || Date.now() - ctx.capturedAt > FOCUS_TRUST_MS) return null;

  const fromUrl = extractMediaPathFromUrl(ctx.activeTabUrl);
  if (fromUrl && matchesExtensions(fromUrl, extensions)) return fromUrl;

  const titleName = ctx.windowTitle
    ? extractMediaNameFromWindowTitle(ctx.windowTitle)
    : null;
  if (!titleName) return null;

  return findMediaOnDiskAsync(titleName, extensions);
}

async function resolveFromViewedMemory(
  kind: "video" | "image",
  extensions: string[],
): Promise<string | null> {
  const atKey: MemoryAtKey =
    kind === "video" ? "last_viewed_video_at" : "last_viewed_image_at";
  if (!isViewedMediaFresh(atKey)) return null;

  const viewedKey =
    kind === "video" ? "last_viewed_video" : "last_viewed_image";
  const viewed = getMemory(viewedKey);
  if (viewed && existsSync(viewed) && matchesExtensions(viewed, extensions)) {
    return viewed;
  }

  const titleKey =
    kind === "video" ? "last_viewed_video_title" : "last_viewed_image_title";
  const viewedTitle = getMemory(titleKey);
  if (viewedTitle) {
    const resolved = await findMediaOnDiskAsync(viewedTitle, extensions);
    if (resolved) return resolved;
  }

  return null;
}

function resolveFromRecentOpens(extensions: string[]): string | null {
  for (const path of searchRecentOpenedPathsByExtensions(extensions, 15)) {
    if (existsSync(path)) return path;
  }
  for (const path of searchRecentDesktopHistoryPathsByExtensions(
    extensions,
    15,
  )) {
    if (existsSync(path)) return path;
  }
  return null;
}

function resolveFromSessionMemory(
  kind: "video" | "image",
  extensions: string[],
): string | null {
  const key = kind === "video" ? "last_video" : "last_image";
  const path = getMemory(key);
  if (path && existsSync(path) && matchesExtensions(path, extensions)) {
    return path;
  }
  return null;
}

async function resolveLastMediaPath(
  ctx: FocusContext | null,
  kind: "video" | "image",
  extensions: string[],
): Promise<string | null> {
  // Chronological opens/views (incl. Photos focus watcher) beat stale session memory.
  const fromRecent = resolveFromRecentOpens(extensions);
  if (fromRecent) return fromRecent;

  const fromViewed = await resolveFromViewedMemory(kind, extensions);
  if (fromViewed) return fromViewed;

  const fromFocus = await resolveFromFocusTitle(ctx, extensions);
  if (fromFocus) return fromFocus;

  return resolveFromSessionMemory(kind, extensions);
}

export async function resolveLastVideoPath(
  ctx: FocusContext | null,
): Promise<string | null> {
  const { resolveLastOpenedByKind } = await import("./p8RecallResolver.js");
  return resolveLastOpenedByKind("video", ctx);
}

export async function resolveLastImagePath(
  ctx: FocusContext | null,
): Promise<string | null> {
  const { resolveLastOpenedByKind } = await import("./p8RecallResolver.js");
  return resolveLastOpenedByKind("image", ctx);
}
