import { existsSync, statSync } from "node:fs";
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "./mediaFocusMemory.js";

export type OpenedItemKind = "pdf" | "image" | "video" | "folder" | "file";

const IMAGE_EXT_SET = new Set(IMAGE_EXTENSIONS);
const VIDEO_EXT_SET = new Set(VIDEO_EXTENSIONS);

function extensionOf(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? "";
}

export function classifyOpenedPath(path: string): OpenedItemKind | null {
  if (!path?.trim() || !existsSync(path)) return null;
  try {
    const st = statSync(path);
    if (st.isDirectory()) return "folder";
  } catch {
    return null;
  }

  const ext = extensionOf(path);
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT_SET.has(ext)) return "image";
  if (VIDEO_EXT_SET.has(ext)) return "video";
  return "file";
}

export function pathMatchesOpenedKind(
  path: string,
  kind: OpenedItemKind,
): boolean {
  const classified = classifyOpenedPath(path);
  if (!classified) return false;
  if (kind === "file") {
    return classified === "file";
  }
  return classified === kind;
}
