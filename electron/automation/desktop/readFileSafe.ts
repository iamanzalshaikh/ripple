import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import { resolveFolderPath } from "./openFolder.js";

const SYSTEM_PATH =
  /\\windows\\system32\b|\\program files\b/i;

export function defaultMaxReadBytes(): number {
  const raw = process.env.RIPPLE_P85_MAX_READ_BYTES;
  const n = raw ? Number.parseInt(raw, 10) : 524_288;
  return Number.isFinite(n) && n > 0 ? n : 524_288;
}

export type FilesystemPathArgs = {
  path?: string;
  parentFolder?: string;
  fileName?: string;
  sourceName?: string;
  folder?: string;
};

/** Resolve spoken or absolute path from tool args. */
export function resolveFilesystemPath(args: FilesystemPathArgs): string | null {
  const direct = args.path?.trim();
  if (direct) {
    return direct;
  }
  const name = (args.fileName ?? args.sourceName)?.trim();
  const parent = (args.parentFolder ?? args.folder)?.trim();
  if (name && parent) {
    return join(resolveFolderPath(parent), name);
  }
  if (name && isAbsolute(name)) {
    return name;
  }
  return null;
}

/** Block traversal and sensitive system paths for P5.1 filesystem tools. */
export function assertSafeUserPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error("missing_path");
  }
  if (trimmed.includes("..")) {
    throw new Error("permission_blocked:Path traversal is not allowed.");
  }
  const normalized = resolve(trimmed);
  if (SYSTEM_PATH.test(normalized.replace(/\//g, "\\"))) {
    throw new Error("permission_blocked:System paths cannot be accessed.");
  }
  return normalized;
}

function readBufferCapped(filePath: string, maxBytes: number): Buffer {
  const st = statSync(filePath);
  if (!st.isFile()) {
    throw new Error("path_is_directory");
  }
  const buf = readFileSync(filePath);
  if (buf.length > maxBytes) {
    return buf.subarray(0, maxBytes);
  }
  return buf;
}

export function readFileSafe(
  inputPath: string,
  maxBytes?: number,
): { content: string; truncated: boolean; bytes: number; path: string } {
  const path = assertSafeUserPath(inputPath);
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  const cap = maxBytes ?? defaultMaxReadBytes();
  const st = statSync(path);
  if (!st.isFile()) {
    throw new Error(`Not a file: ${path}`);
  }
  const buf = readBufferCapped(path, cap);
  if (buf.includes(0)) {
    throw new Error("binary_file_not_supported");
  }
  return {
    content: buf.toString("utf8"),
    truncated: st.size > cap,
    bytes: st.size,
    path,
  };
}

export function getFileMetadata(inputPath: string): Record<string, unknown> {
  const path = assertSafeUserPath(inputPath);
  if (!existsSync(path)) {
    throw new Error(`Path not found: ${path}`);
  }
  const st = statSync(path);
  return {
    path,
    size: st.size,
    isDirectory: st.isDirectory(),
    isFile: st.isFile(),
    modifiedMs: st.mtimeMs,
    createdMs: st.birthtimeMs,
    extension: extname(path).toLowerCase() || null,
  };
}
