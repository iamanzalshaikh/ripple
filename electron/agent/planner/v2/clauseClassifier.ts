import { parseSaveFileCommand } from "../../../automation/desktop/parseSaveFileCommand.js";
import { parseNativeAppCommand } from "../../../automation/desktop/parseNativeAppCommand.js";
import { parseWorkspaceOpenCommand } from "../../../automation/desktop/parseWorkspaceCommand.js";
import { parseFileOperationCommand } from "../../../automation/desktop/parseFileOperationCommand.js";
import { parseSmartSearchCommand } from "../../../automation/desktop/parseSmartSearchCommand.js";
import { parseBrowserWorkspaceSearch } from "../../../automation/browser/parseBrowserWorkspaceSearch.js";
import { parseMediaWorkspaceSearch } from "../../../automation/browser/parseMediaWorkspaceSearch.js";
import { parseWellKnownFolderOpen } from "../../../automation/desktop/folderIntent.js";
import { parseDesktopCommand } from "../../../automation/desktop/parseDesktopCommand.js";
import {
  desktopInputToTypeIntent,
  parseCalculatorInput,
  parseDesktopInputFallback,
} from "../../parseDesktopInput.js";
import { normalizeCompoundPart } from "../compoundClauseResolve.js";
import type { ClauseRecord, ClauseType, ClauseEntities } from "./clauseTypes.js";

const DRAW_SHAPE = /^(?:draw|sketch)\s+(?:a\s+)?(?:circle|oval|square|rectangle|rect|line)\b/i;

/** Soft variants before giving up to UNKNOWN (voice phrasing drift). */
function softParseVariants(raw: string, normalized: string): string[] {
  const variants = new Set<string>([normalized, raw.trim()]);
  variants.add(normalized.replace(/,\s*(?:name|named|called)\s+/gi, " named "));
  variants.add(normalized.replace(/\bname\s+/gi, "named "));
  return [...variants].filter((v) => v.length >= 2);
}

function tryFileOpClassify(
  index: number,
  raw: string,
  variant: string,
): ClauseRecord | null {
  const op = parseFileOperationCommand(variant);
  if (!op) return null;
  return record(index, raw, variant, "FILE_MUTATE", {}, "parseFileOperationCommand", 0.85);
}

export type ClassifierContext = {
  priorRecords: ClauseRecord[];
};

function record(
  index: number,
  raw: string,
  normalized: string,
  clauseType: ClauseType,
  entities: ClauseEntities,
  parseSource: string,
  confidence: number,
  status: ClauseRecord["status"] = "resolved",
): ClauseRecord {
  return {
    index,
    raw,
    normalized,
    clauseType,
    confidence,
    entities,
    parseSource,
    status,
  };
}

function priorWorkspaceId(ctx: ClassifierContext): string | undefined {
  for (let i = ctx.priorRecords.length - 1; i >= 0; i--) {
    const r = ctx.priorRecords[i];
    if (r?.clauseType === "WORKSPACE_OPEN" && r.entities.workspaceId) {
      return r.entities.workspaceId;
    }
  }
  return undefined;
}

function classifySearchClause(
  normalized: string,
  ctx: ClassifierContext,
): ClauseRecord | null {
  const priorWs = priorWorkspaceId(ctx);

  const media = parseMediaWorkspaceSearch(normalized);
  if (media) {
    const engine = priorWs === "youtube" || !priorWs ? "youtube" : "google";
    return record(0, normalized, normalized, "MEDIA_SEARCH", {
      searchQuery: media.query,
      searchEngine: engine as "youtube" | "google",
    }, "parseMediaWorkspaceSearch", 0.9);
  }

  const fileSearch = parseSmartSearchCommand(normalized);
  if (fileSearch) {
    const token =
      fileSearch.query.type === "latest_token"
        ? fileSearch.query.token
        : fileSearch.label;
    const isFileLike =
      /\b(?:resume|cv|pdf|document|spreadsheet|download|folder|file|image|photo|presentation)\b/i.test(
        normalized,
      );
    if (isFileLike) {
      return record(0, normalized, normalized, "FILE_SEARCH", {
        searchQuery: token,
      }, "parseSmartSearchCommand", 0.85);
    }
  }

  const web = parseBrowserWorkspaceSearch(normalized);
  if (web) {
    if (priorWs === "youtube") {
      return record(0, normalized, normalized, "MEDIA_SEARCH", {
        searchQuery: web.query,
        searchEngine: "youtube",
      }, "context_youtube_search", 0.88);
    }
    return record(0, normalized, normalized, "WEB_SEARCH", {
      searchQuery: web.query,
      searchEngine: "google",
    }, "parseBrowserWorkspaceSearch", 0.88);
  }

  if (/^\s*search\b/i.test(normalized)) {
    const m = normalized.match(/^\s*search\s+(?:for\s+)?(.+?)\s*$/i);
    const q = m?.[1]?.trim();
    if (q) {
      if (priorWs === "youtube") {
        return record(0, normalized, normalized, "MEDIA_SEARCH", {
          searchQuery: q,
          searchEngine: "youtube",
        }, "context_youtube_fallback", 0.75);
      }
      return record(0, normalized, normalized, "WEB_SEARCH", {
        searchQuery: q,
        searchEngine: "google",
      }, "search_fallback", 0.7);
    }
  }

  return null;
}

/** L2 — classify one compound clause with optional prior context. */
export function classifyClause(
  raw: string,
  index: number,
  ctx: ClassifierContext = { priorRecords: [] },
): ClauseRecord {
  const normalized = normalizeCompoundPart(raw.trim());

  if (normalized.length < 2) {
    return record(index, raw, normalized, "UNKNOWN", {}, "too_short", 0.2, "unsupported");
  }

  const save = parseSaveFileCommand(normalized);
  if (save) {
    return record(index, raw, normalized, "SAVE_FILE", {
      saveFilename: save.filename,
      ...(save.folder ? { saveFolder: save.folder } : {}),
    }, "parseSaveFileCommand", 0.92);
  }

  const calc = parseCalculatorInput(normalized);
  if (calc) {
    const text = calc.mode === "text" ? calc.text : undefined;
    return record(index, raw, normalized, "TYPE_TEXT", {
      typeText: text ?? String(calc),
    }, "parseCalculatorInput", 0.9);
  }

  const input = parseDesktopInputFallback(normalized);
  if (input) {
    const intent = desktopInputToTypeIntent(input);
    return record(index, raw, normalized, "TYPE_TEXT", {
      typeText: intent.text,
    }, "parseDesktopInputFallback", 0.9);
  }

  if (DRAW_SHAPE.test(normalized)) {
    const shape = normalized.match(/\b(circle|oval|square|rectangle|rect|line)\b/i)?.[1];
    return record(index, raw, normalized, "DRAW_SHAPE", {
      drawShape: shape?.toLowerCase() ?? "circle",
    }, "draw_pattern", 0.88);
  }

  const app = parseNativeAppCommand(normalized);
  if (app) {
    if (app.kind === "launch_app") {
      return record(index, raw, normalized, "APP_LAUNCH", {
        appId: app.app.id,
        spokenName: app.rawName,
      }, "parseNativeAppCommand", 0.93);
    }
    if (app.kind === "switch_app") {
      return record(index, raw, normalized, "APP_FOCUS", {
        appId: app.app.id,
        spokenName: app.rawName,
      }, "parseNativeAppCommand", 0.93);
    }
    if (app.kind === "close_app") {
      return record(index, raw, normalized, "APP_CLOSE", {
        appId: app.app.id,
        spokenName: app.rawName,
      }, "parseNativeAppCommand", 0.93);
    }
  }

  const workspace = parseWorkspaceOpenCommand(normalized);
  if (workspace?.kind === "open_workspace") {
    return record(index, raw, normalized, "WORKSPACE_OPEN", {
      workspaceId: workspace.workspace.id,
      workspaceUrl: workspace.workspace.url,
      spokenName: workspace.spokenName,
    }, "parseWorkspaceOpenCommand", 0.93);
  }

  const searchRecord = classifySearchClause(normalized, ctx);
  if (searchRecord) {
    return { ...searchRecord, index, raw };
  }

  const folder = parseWellKnownFolderOpen(normalized);
  if (folder?.kind === "folder") {
    return record(index, raw, normalized, "FOLDER_OPEN", {
      folder: folder.folder,
    }, "parseWellKnownFolderOpen", 0.9);
  }

  const fileOp = parseFileOperationCommand(normalized);
  if (fileOp) {
    return record(index, raw, normalized, "FILE_MUTATE", {}, "parseFileOperationCommand", 0.85);
  }

  for (const variant of softParseVariants(raw, normalized)) {
    if (variant === normalized) continue;
    const softFileOp = tryFileOpClassify(index, raw, variant);
    if (softFileOp) return softFileOp;
  }

  const desktop = parseDesktopCommand(normalized);
  if (desktop) {
    if (desktop.kind === "folder") {
      return record(index, raw, normalized, "FOLDER_OPEN", {
        folder: desktop.folder,
      }, "parseDesktopCommand", 0.88);
    }
    if (desktop.kind === "file") {
      return record(index, raw, normalized, "FILE_OPEN", {
        filename: desktop.filename,
      }, "parseDesktopCommand", 0.88);
    }
    if (desktop.kind === "item") {
      return record(index, raw, normalized, "FILE_OPEN", {
        itemName: desktop.name,
        parentFolder: desktop.parent,
      }, "parseDesktopCommand", 0.85);
    }
  }

  return record(index, raw, normalized, "UNKNOWN", {}, "no_match", 0.3, "unsupported");
}

export function classifyClauses(
  parts: string[],
): ClauseRecord[] {
  const records: ClauseRecord[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = classifyClause(parts[i]!, i, { priorRecords: records });
    records.push(rec);
  }
  return records;
}
