import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, extname, join } from "node:path";

/** Chrome Native Messaging JSON payload must stay under ~1MB. */
const MAX_ATTACHMENT_BYTES = 700_000;

/** WhatsApp Web "Document" attach — zip/json/code are rejected with "not supported". */
const WHATSAPP_ATTACH_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".3gp",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".3gp": "video/3gpp",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
};

const EXT_PRIORITY = [
  ".pdf",
  ".docx",
  ".doc",
  ".png",
  ".jpg",
  ".jpeg",
  ".xlsx",
  ".pptx",
  ".txt",
  ".mp4",
];

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".cursor",
  "dist",
  "out",
  "build",
  ".next",
  "coverage",
  "__pycache__",
]);

export type WhatsAppAttachmentPayload = {
  fileName: string;
  mimeType: string;
  base64: string;
};

export function isWhatsAppSupportedExtension(ext: string): boolean {
  return WHATSAPP_ATTACH_EXT.has(ext.toLowerCase());
}

function mimeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function extRank(ext: string): number {
  const i = EXT_PRIORITY.indexOf(ext.toLowerCase());
  return i >= 0 ? i : 99;
}

/** Collect WhatsApp-supported files under a folder (skip dev dirs). */
export function findAttachableFilesInFolder(
  folderPath: string,
  maxBytes = MAX_ATTACHMENT_BYTES,
): string[] {
  const found: { path: string; size: number; rank: number }[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > 8) return;
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name.toLowerCase())) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;

      const ext = extname(ent.name).toLowerCase();
      if (!WHATSAPP_ATTACH_EXT.has(ext)) continue;

      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        continue;
      }
      if (size <= 0 || size > maxBytes) continue;

      found.push({ path: full, size, rank: extRank(ext) });
    }
  }

  walk(folderPath, 0);
  found.sort((a, b) => a.rank - b.rank || a.size - b.size);
  return found.map((f) => f.path);
}

function readFileAttachment(filePath: string): WhatsAppAttachmentPayload | null {
  const ext = extname(filePath).toLowerCase();
  if (!WHATSAPP_ATTACH_EXT.has(ext)) {
    console.warn(
      `[ripple-desktop] WhatsApp attach skipped — unsupported type ${ext}`,
    );
    return null;
  }

  const st = statSync(filePath);
  if (!st.isFile()) return null;
  if (st.size > MAX_ATTACHMENT_BYTES) {
    console.warn(
      `[ripple-desktop] WhatsApp attach skipped — file too large (${st.size} bytes, max ${MAX_ATTACHMENT_BYTES})`,
    );
    return null;
  }

  const base64 = readFileSync(filePath).toString("base64");
  return {
    fileName: basename(filePath),
    mimeType: mimeForPath(filePath),
    base64,
  };
}

/**
 * Prepare a file or best supported file inside a folder for WhatsApp attach.
 * WhatsApp Web rejects .zip and most code files — never zip folders for attach.
 */
export async function prepareWhatsAppAttachment(
  sourcePath: string,
): Promise<WhatsAppAttachmentPayload | null> {
  const trimmed = sourcePath.trim();
  if (!trimmed || !existsSync(trimmed)) return null;

  const st = statSync(trimmed);
  if (st.isDirectory()) {
    const candidates = findAttachableFilesInFolder(trimmed);
    if (candidates.length === 0) {
      console.warn(
        `[ripple-desktop] WhatsApp attach skipped — no supported files in folder "${basename(trimmed)}" (use PDF, PNG, DOCX, etc.)`,
      );
      return null;
    }
    const best = candidates[0]!;
    console.info(
      `[ripple-desktop] WhatsApp folder attach → ${basename(best)} (from ${basename(trimmed)})`,
    );
    return readFileAttachment(best);
  }

  if (!st.isFile()) {
    console.info(
      `[ripple-desktop] WhatsApp attach skipped — not a file: ${trimmed}`,
    );
    return null;
  }

  return readFileAttachment(trimmed);
}
