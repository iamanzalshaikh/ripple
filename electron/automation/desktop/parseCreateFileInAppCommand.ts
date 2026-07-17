import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { cwd } from "node:process";
import { existsSync } from "node:fs";
import { normalizeTranscript } from "../voice/normalizeTranscript.js";

const EDITOR_APPS =
  /^(?:cursor|vs\s*code|visual\s+studio\s+code|notepad|word)$/i;

export type CreateFileInAppIntent = {
  kind: "create_file_in_app";
  filename: string;
  application: string;
};

function normalizeEditorApp(raw: string): string {
  const app = raw.trim().toLowerCase();
  if (/^(?:vs\s*code|visual\s+studio\s+code)$/.test(app)) return "cursor";
  return app;
}

function normalizeFilename(raw: string): string {
  let name = raw.trim().replace(/^[,.\s]+|[,.\s]+$/g, "");
  if (!name) return name;
  if (!/\.[a-z0-9]{2,8}$/i.test(name)) {
    name = `${name}.txt`;
  }
  return name;
}

/** Repair Whisper glitches like "server.jsin cursor" → "server.js in cursor". */
export function repairCreateFileGlitch(cmd: string): string {
  return cmd
    .replace(
      /(\.[a-z0-9]{1,12})(in|inside)\s+(cursor|notepad|word|vs\s*code|visual\s+studio\s+code)\b/gi,
      "$1 in $3",
    )
    .replace(
      /\bcreate\s+(?:a\s+)?new\s+file\s*,\s*/gi,
      "create new file ",
    )
    .replace(/\bcreate\s+a\s+new\s+file\b/gi, "create new file");
}

/**
 * Parse spoken create-file-in-editor commands.
 * Examples:
 * - "create file api.ts in cursor"
 * - "create a new file, server.js in cursor"
 * - "create new file server.js in cursor"
 */
export function parseCreateFileInAppCommand(
  command?: string | null,
): CreateFileInAppIntent | null {
  let cmd = repairCreateFileGlitch(normalizeTranscript(command ?? "").trim());
  if (!cmd) return null;

  const patterns = [
    /^\s*create\s+(?:a\s+)?(?:new\s+)?file\s*,?\s*(.+?)\s+(?:in|on)\s+(?:the\s+)?(cursor|vs\s*code|visual\s+studio\s+code|notepad|word)\s*$/i,
    /^\s*create\s+(?:a\s+)?(?:new\s+)?file\s+(?:called|named)\s+(.+?)\s+(?:in|on)\s+(?:the\s+)?(cursor|vs\s*code|visual\s+studio\s+code|notepad|word)\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = cmd.match(pattern);
    const filePart = match?.[1]?.trim();
    const appPart = match?.[2]?.trim();
    if (!filePart || !appPart || !EDITOR_APPS.test(appPart)) continue;
    return {
      kind: "create_file_in_app",
      filename: normalizeFilename(filePart),
      application: normalizeEditorApp(appPart),
    };
  }

  return null;
}

/** Infer local project folder from Cursor/VS Code window title. */
export function inferEditorProjectPath(windowTitle?: string | null): string | null {
  const title = (windowTitle ?? "").trim();
  if (!title) return null;

  const patterns = [
    /^.+?\s+-\s+(.+?)\s+-\s+Cursor$/i,
    /^.+?\s+-\s+(.+?)\s+-\s+Visual Studio Code$/i,
    /^(.+?)\s+-\s+Cursor$/i,
  ];

  const projectNames: string[] = [];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]?.trim()) {
      projectNames.push(match[1].trim());
      break;
    }
  }
  // Titles may arrive truncated (e.g. "file.spec.ts - pr"); try every
  // " - " segment as a candidate project folder name too.
  for (const segment of title.split(/\s+-\s+/)) {
    const name = segment.trim();
    if (
      name &&
      !/^cursor$/i.test(name) &&
      !/\.[a-z0-9]{1,8}$/i.test(name) &&
      !projectNames.includes(name)
    ) {
      projectNames.push(name);
    }
  }
  if (projectNames.length === 0) return null;

  const home = homedir();
  for (const projectName of projectNames) {
    const candidates = [
      join(home, "Desktop", projectName),
      join(home, "OneDrive", "Desktop", projectName),
      join(home, "Documents", projectName),
      join(home, "OneDrive", "Documents", projectName),
      join(home, "Projects", projectName),
      join(home, "source", projectName),
      join(home, "dev", projectName),
      join(home, "code", projectName),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Dev fallback: walk cwd up to a git/package root (e.g. ripple-desktop → projectRipple). */
export function inferEditorProjectPathFromDevCwd(): string | null {
  let dir = cwd();
  for (let depth = 0; depth < 10; depth++) {
    if (
      existsSync(join(dir, ".git")) ||
      existsSync(join(dir, "package.json"))
    ) {
      return dir;
    }
    if (basename(dir).toLowerCase() === "ripple-desktop") {
      const parent = dirname(dir);
      if (existsSync(parent)) return parent;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Try each editor window title, then dev cwd fallback. */
export function resolveEditorWorkspace(
  titles: Iterable<string | null | undefined>,
): string | null {
  for (const title of titles) {
    const path = inferEditorProjectPath(title);
    if (path) return path;
  }
  return inferEditorProjectPathFromDevCwd();
}
