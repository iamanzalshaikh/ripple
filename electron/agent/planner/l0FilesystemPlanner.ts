import { normalizeFolderKey } from "../../automation/desktop/folderIntent.js";
import { parseParentKey } from "../../automation/desktop/fileOpParse.js";
import {
  parseListDirectoryCommand,
  planFromListDirectory,
} from "./l0ListDirectory.js";
import type { ExecutionPlan, L0PlannerResult } from "./planTypes.js";

export type FilesystemSearchIntent = { kind: "search"; query: string };
export type FilesystemReadIntent = {
  kind: "read_file";
  fileName: string;
  parentFolder?: string;
};
export type FilesystemMetadataIntent = {
  kind: "get_metadata";
  fileName: string;
  parentFolder?: string;
};

export type FilesystemWriteIntent = {
  kind: "write_file";
  fileName: string;
  content: string;
  parentFolder?: string;
};

export type FilesystemPlannerIntent =
  | FilesystemSearchIntent
  | FilesystemReadIntent
  | FilesystemMetadataIntent
  | FilesystemWriteIntent
  | { kind: "list_directory"; parentFolder: string };

function normalizeCmd(command: string): string {
  return command.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseFilesystemSearchCommand(
  command?: string | null,
): FilesystemSearchIntent | null {
  const cmd = normalizeCmd(command ?? "");
  if (!cmd) return null;

  if (
    /\b(?:whatsapp|youtube|linkedin|instagram|gmail|on\s+whatsapp|on\s+youtube|on\s+linkedin|on\s+instagram)\b/i.test(
      cmd,
    )
  ) {
    return null;
  }
  // Never treat code-bug / codebase review as a filename search (avoids random
  // node_modules hits like HerRIdez when Cursor is focused on another project).
  if (
    /\b(?:bug|bugs|error|errors|issue|issues|broken|crash|crashing|debug|codebase|typecheck|eslint)\b/i.test(
      cmd,
    ) &&
    /\b(?:find|search|locate|look\s+for|check|scan|review|analy[sz]e|inspect)\b/i.test(
      cmd,
    )
  ) {
    return null;
  }
  if (
    /\b(?:in\s+(?:my\s+)?(?:current\s+)?(?:code|project|repo|codebase)|current\s+code)\b/i.test(
      cmd,
    )
  ) {
    return null;
  }
  if (
    /^\s*search\s+.+\s+and\s+(?:ask|say|tell|type|write|message)\b/i.test(cmd)
  ) {
    return null;
  }
  if (/^\s*search\s+(?:for\s+)?(?:dr|mr|mrs|ms)\.?\s+/i.test(cmd)) {
    return null;
  }
  if (
    /^\s*search\s+(?:for\s+)?(?:my\s+|the\s+)/i.test(cmd) &&
    !/\b(?:file|files|folder|pdf|backend|project|horizon|document)\b/i.test(cmd)
  ) {
    return null;
  }

  const patterns = [
    /^(?:find|search(?:\s+for)?|locate|look\s+for)\s+(?:my\s+|the\s+)?(.+?)\s*$/,
    /^(?:where\s+is|where's)\s+(?:my\s+|the\s+)?(.+?)\s*$/,
  ];

  for (const pattern of patterns) {
    const match = cmd.match(pattern);
    const query = match?.[1]?.trim();
    if (!query) continue;
    if (/^(?:downloads?|documents?|desktop)$/i.test(query)) continue;
    return { kind: "search", query };
  }

  return null;
}

const BLOCKED_READ_TARGETS =
  /^(?:downloads?|documents?|desktop|notepad|chrome|calculator|vscode?|vs\s*code|visual\s+studio\s+code)$/i;

export function parseFilesystemReadCommand(
  command?: string | null,
): FilesystemReadIntent | null {
  const raw = (command ?? "").trim();
  const cmd = normalizeCmd(raw);
  if (!cmd) return null;

  if (
    /\b(?:visible text|webpage|web page|current webpage|from the browser)\b/i.test(
      cmd,
    )
  ) {
    return null;
  }
  if (/\bgit\s+status\b/i.test(cmd) || /\bcode changes\b/i.test(cmd)) {
    return null;
  }

  const patterns = [
    /^(?:read|show|display)\s+(?:me\s+)?(?:the\s+)?(?:file\s+)?(.+?)(?:\s+(?:in|from)\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop))?\s*$/,
    /^(?:what(?:'s| is)\s+in)\s+(?:the\s+)?(?:file\s+)?(.+?)(?:\s+(?:in|from)\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop))?\s*$/,
    /^(?:open)\s+(?:the\s+)?(?:file\s+)?(.+\.[a-z0-9]{1,12})(?:\s+(?:in|from)\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop))?\s*$/,
  ];

  for (const pattern of patterns) {
    const match = cmd.match(pattern);
    const filePart = match?.[1]?.trim();
    if (!filePart) continue;
    if (BLOCKED_READ_TARGETS.test(filePart)) continue;
    if (/^(?:downloads?|documents?|desktop)(?:\s+folder)?$/i.test(filePart)) continue;
    if (/\bclipboard\b/i.test(filePart)) continue;
    const parentRaw = match?.[2];
    return {
      kind: "read_file",
      fileName: filePart.replace(/\s+file\s*$/i, "").trim(),
      ...(parentRaw ? { parentFolder: parseParentKey(parentRaw) } : {}),
    };
  }

  return null;
}

export function parseFilesystemMetadataCommand(
  command?: string | null,
): FilesystemMetadataIntent | null {
  const cmd = normalizeCmd(command ?? "");
  if (!cmd) return null;

  const match =
    cmd.match(
      /^(?:get|show)\s+(?:file\s+)?(?:info|metadata|details)\s+(?:for|on|about|of)\s+(?:the\s+)?(.+?)(?:\s+(?:in|from)\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop|horizon backend|.+?))?\s*$/,
    ) ??
    cmd.match(
      /^show\s+metadata\s+of\s+(.+?)(?:\s+in\s+.+?)?\s*$/,
    );
  const filePart = match?.[1]?.trim();
  if (!filePart) return null;
  const parentRaw = match?.[2];
  return {
    kind: "get_metadata",
    fileName: filePart,
    ...(parentRaw ? { parentFolder: parseParentKey(parentRaw) } : {}),
  };
}

export function parseFilesystemWriteCommand(
  command?: string | null,
): FilesystemWriteIntent | null {
  const raw = command?.trim() ?? "";
  if (!raw) return null;
  const m =
    raw.match(/^\s*write\s+["'](.+?)["']\s+into\s+(.+?)\s*$/i) ??
    raw.match(/^\s*write\s+(.+?)\s+into\s+(.+?)\s*$/i);
  if (!m?.[1] || !m?.[2]) return null;
  const fileName = m[2].trim();
  if (!fileName || /\b(?:browser|google|web)\b/i.test(fileName)) return null;
  return { kind: "write_file", fileName, content: m[1].trim() };
}

export function parseFilesystemPlannerIntent(
  command?: string | null,
): FilesystemPlannerIntent | null {
  const list = parseListDirectoryCommand(command);
  if (list) return { kind: "list_directory", parentFolder: list.parentFolder };

  const search = parseFilesystemSearchCommand(command);
  if (search) return search;

  const read = parseFilesystemReadCommand(command);
  if (read) return read;

  const meta = parseFilesystemMetadataCommand(command);
  if (meta) return meta;

  const write = parseFilesystemWriteCommand(command);
  if (write) return write;

  return null;
}

/** True when utterance should stay on filesystem L0 (not compound splitter). */
export function isFilesystemPlannerUtterance(
  command: string,
  _normalized?: string,
): boolean {
  return parseFilesystemPlannerIntent(command) !== null;
}

function searchPlan(
  query: string,
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal: `Find ${query}`,
    confidence: 0.91,
    steps: [
      {
        tool: "filesystem.search",
        args: { query, name: query },
        reason: "filesystem_search",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function readPlan(
  intent: FilesystemReadIntent,
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  const args: Record<string, unknown> = {
    fileName: intent.fileName,
    path: intent.fileName,
  };
  if (intent.parentFolder) {
    args.parentFolder = intent.parentFolder;
  }
  return {
    goal: `Read ${intent.fileName}`,
    confidence: 0.9,
    steps: [
      {
        tool: "filesystem.read_file",
        args,
        reason: "filesystem_read",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function metadataPlan(
  intent: FilesystemMetadataIntent,
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  const args: Record<string, unknown> = {
    fileName: intent.fileName,
    path: intent.fileName,
  };
  if (intent.parentFolder) {
    args.parentFolder = intent.parentFolder;
  }
  return {
    goal: `Metadata for ${intent.fileName}`,
    confidence: 0.88,
    steps: [
      {
        tool: "filesystem.get_metadata",
        args,
        reason: "filesystem_metadata",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function writePlan(
  intent: FilesystemWriteIntent,
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  const args: Record<string, unknown> = {
    path: intent.fileName,
    fileName: intent.fileName,
    content: intent.content,
    parentFolder: intent.parentFolder ?? "documents",
    createDirs: true,
  };
  return {
    goal: `Write ${intent.fileName}`,
    confidence: 0.9,
    steps: [
      {
        tool: "filesystem.write_file",
        args,
        reason: "filesystem_write",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

/**
 * L0 filesystem intelligence — search, read, list, metadata.
 * P8.5-P5.1 voice → filesystem.* tools.
 */
export function tryL0FilesystemPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const intent = parseFilesystemPlannerIntent(rawCommand);
  if (!intent) return null;

  if (intent.kind === "list_directory") {
    return {
      kind: "plan",
      plan: planFromListDirectory(
        intent.parentFolder,
        rawCommand,
        normalized,
      ),
    };
  }

  if (intent.kind === "search") {
    return {
      kind: "plan",
      plan: searchPlan(intent.query, rawCommand, normalized),
    };
  }

  if (intent.kind === "read_file") {
    return {
      kind: "plan",
      plan: readPlan(intent, rawCommand, normalized),
    };
  }

  if (intent.kind === "get_metadata") {
    return {
      kind: "plan",
      plan: metadataPlan(intent, rawCommand, normalized),
    };
  }

  if (intent.kind === "write_file") {
    return {
      kind: "plan",
      plan: writePlan(intent, rawCommand, normalized),
    };
  }

  return null;
}
