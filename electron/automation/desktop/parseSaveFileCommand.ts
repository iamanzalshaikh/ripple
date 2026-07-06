import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import { normalizeFolderKey } from "./folderIntent.js";

export type SaveFileIntent = {
  kind: "save_file";
  filename: string;
  folder?: "downloads" | "documents" | "desktop";
};

function normalizeFilename(raw: string): string {
  let name = raw.trim();
  if (!name) return name;
  if (!/\.[a-z0-9]{2,8}$/i.test(name)) {
    name = `${name}.txt`;
  }
  return name;
}

function folderFromMatch(raw?: string): SaveFileIntent["folder"] | undefined {
  if (!raw?.trim()) return undefined;
  return normalizeFolderKey(raw) ?? undefined;
}

/** "save the file as meetingnotes.txt inside documents" */
export function parseSaveFileCommand(
  command?: string | null,
): SaveFileIntent | null {
  const cmd = normalizeTranscript(command ?? "").trim();
  if (!cmd) return null;

  const patterns: Array<{ re: RegExp; file: number; folder?: number }> = [
    {
      re: /^\s*save\s+(?:the\s+)?file\s+as\s+(.+?)\s+(?:inside|in|to)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
      file: 1,
      folder: 2,
    },
    {
      re: /^\s*save\s+(?:this|it|that)?\s*as\s+(.+?)\s+(?:inside|in|to)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
      file: 1,
      folder: 2,
    },
    {
      re: /^\s*save\s+as\s+(.+?)\s+(?:inside|in|to)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
      file: 1,
      folder: 2,
    },
    {
      re: /^\s*store\s+as\s+(.+?)\s+(?:inside|in|to)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
      file: 1,
      folder: 2,
    },
    {
      re: /^\s*save\s+(?:the\s+)?file\s+as\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*save\s+as\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*save\s+file\s+in\s+(downloads?|documents?|desktop)\s+(.+?)\s*$/i,
      file: 2,
      folder: 1,
    },
    {
      re: /^\s*save\s+(?:the\s+)?file\s+(.+?)\s+(?:inside|in|to)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/i,
      file: 1,
      folder: 2,
    },
    {
      re: /^\s*save\s+(?:the\s+)?file\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*create\s+file\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*create\s+new\s+file\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*create\s+a\s+file\s+called\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*save\s+current\s+file\s+as\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*save\s+everything\s+as\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*store\s+(?:this\s+text\s+)?in\s+a\s+file\s+named\s+(.+?)\s*$/i,
      file: 1,
    },
    {
      re: /^\s*store\s+(?:it|this|everything)\s+as\s+(?:a\s+)?(?:file\s+)?(.+?)\s*$/i,
      file: 1,
    },
  ];

  for (const { re, file, folder } of patterns) {
    const m = cmd.match(re);
    if (!m?.[file]?.trim()) continue;
    return {
      kind: "save_file",
      filename: normalizeFilename(m[file]!),
      folder: folder ? folderFromMatch(m[folder]) : undefined,
    };
  }

  return null;
}

export function isSaveFileCommand(command?: string | null): boolean {
  return parseSaveFileCommand(command) !== null;
}
