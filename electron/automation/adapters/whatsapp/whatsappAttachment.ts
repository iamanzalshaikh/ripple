import { readFileSync, statSync, existsSync } from "node:fs";
import { basename, extname } from "node:path";

/** Chrome Native Messaging JSON payload must stay under ~1MB. */
const MAX_ATTACHMENT_BYTES = 700_000;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

export type WhatsAppAttachmentPayload = {
  fileName: string;
  mimeType: string;
  base64: string;
};

function mimeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Read a local file for WhatsApp attach. Folders and oversized files return null. */
export function prepareWhatsAppAttachment(
  sourcePath: string,
): WhatsAppAttachmentPayload | null {
  const trimmed = sourcePath.trim();
  if (!trimmed || !existsSync(trimmed)) return null;

  const st = statSync(trimmed);
  if (!st.isFile()) {
    console.info(
      `[ripple-desktop] WhatsApp attach skipped — not a file: ${trimmed}`,
    );
    return null;
  }
  if (st.size > MAX_ATTACHMENT_BYTES) {
    console.warn(
      `[ripple-desktop] WhatsApp attach skipped — file too large (${st.size} bytes, max ${MAX_ATTACHMENT_BYTES})`,
    );
    return null;
  }

  const base64 = readFileSync(trimmed).toString("base64");
  return {
    fileName: basename(trimmed),
    mimeType: mimeForPath(trimmed),
    base64,
  };
}
