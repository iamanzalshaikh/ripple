import { parseSaveFileCommand } from "../../../automation/desktop/parseSaveFileCommand.js";
import { parseCreateFileInAppCommand } from "../../../automation/desktop/parseCreateFileInAppCommand.js";
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
  parseClipboardCommand,
  parseDesktopInputFallback,
} from "../../parseDesktopInput.js";
import { parseAutomationClause } from "../parseAutomationClause.js";
import { normalizeCompoundPart } from "../compoundClauseResolve.js";
import type { ClauseRecord, ClauseType, ClauseEntities } from "./clauseTypes.js";

const DRAW_SHAPE_NAMES =
  "circles?|circle|oval|square|rectangle|rect|line|triangle|shape|star|heart|dot|house|smiley(?:\\s+face)?|box|random\\s+thing|something";
const DRAW_SHAPE = new RegExp(
  `^(?:draw|sketch|create\\s+drawing\\s+of)(?:\\s+(?:\\d+|a|an|multiple|something|random\\s+thing))?\\s*(?:${DRAW_SHAPE_NAMES})?\\b`,
  "i",
);
const GRAPHICS_APP_IDS = new Set(["paint", "mspaint"]);

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
  /**
   * Live context-aware routing hint — the workspace/site the user is currently
   * on (e.g. "youtube"), resolved from the foreground window. Biases a bare
   * "search X" toward the current site when no in-utterance prior exists.
   */
  activeWorkspaceId?: string;
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
  // No in-utterance workspace clause — fall back to the live foreground context
  // (e.g. the user is already on youtube.com).
  return ctx.activeWorkspaceId;
}

function priorLaunchAppId(ctx: ClassifierContext): string | undefined {
  for (let i = ctx.priorRecords.length - 1; i >= 0; i--) {
    const r = ctx.priorRecords[i];
    if (r?.clauseType === "APP_LAUNCH" && r.entities.appId) {
      return r.entities.appId;
    }
  }
  return undefined;
}

/** Voice often says "type draw circle" — strip false type prefix before shape match. */
function normalizeDrawClause(normalized: string): string {
  return normalized
    .replace(/^(?:please\s+)?(?:type|write|insert)\s+/i, "")
    .trim();
}

function shapeFromDrawText(text: string): string | undefined {
  const m = text.match(new RegExp(`\\b(${DRAW_SHAPE_NAMES})\\b`, "i"));
  const raw = m?.[1]?.toLowerCase();
  if (!raw) return undefined;
  if (raw === "circles" || raw === "circle") return "circle";
  return raw;
}

function drawCountFromText(text: string): number {
  const num = text.match(
    /\b(\d+)\s+(?:circles?|shapes?|squares?|ovals?|rectangles?|lines?|triangles?)\b/i,
  );
  if (num?.[1]) {
    return Math.min(8, Math.max(1, parseInt(num[1], 10)));
  }
  if (/\bmultiple\b/i.test(text)) return 3;
  return 1;
}

function drawShapeEntities(text: string): ClauseEntities {
  return {
    drawShape: shapeFromDrawText(text) ?? "circle",
    drawCount: drawCountFromText(text),
  };
}

function tryClassifyContextClose(
  index: number,
  raw: string,
  normalized: string,
  ctx: ClassifierContext,
): ClauseRecord | null {
  if (!/^\s*close\s+(?:the\s+)?(?:app|it)\s*$/i.test(normalized)) return null;
  const priorApp = priorLaunchAppId(ctx);
  if (!priorApp) return null;
  return record(
    index,
    raw,
    normalized,
    "APP_CLOSE",
    { appId: priorApp },
    "context_close_app",
    0.9,
  );
}

function tryClassifyDrawShape(
  index: number,
  raw: string,
  normalized: string,
  ctx: ClassifierContext,
): ClauseRecord | null {
  const candidate = normalizeDrawClause(normalized);

  if (DRAW_SHAPE.test(candidate)) {
    return record(
      index,
      raw,
      normalized,
      "DRAW_SHAPE",
      drawShapeEntities(candidate),
      "draw_pattern",
      0.88,
    );
  }

  const priorApp = priorLaunchAppId(ctx);
  if (priorApp && GRAPHICS_APP_IDS.has(priorApp)) {
    const bareShape = candidate.match(
      new RegExp(`^(?:a|an)\\s+(${DRAW_SHAPE_NAMES})\\b`, "i"),
    );
    if (bareShape) {
      return record(
        index,
        raw,
        normalized,
        "DRAW_SHAPE",
        drawShapeEntities(candidate),
        "context_graphics_bare_shape",
        0.88,
      );
    }
    if (/\b(?:draw|sketch)\b/i.test(candidate)) {
      return record(
        index,
        raw,
        normalized,
        "DRAW_SHAPE",
        drawShapeEntities(candidate),
        "context_graphics_draw",
        0.9,
      );
    }
    if (/^create\s+drawing(?:\s+of)?/i.test(candidate)) {
      return record(
        index,
        raw,
        normalized,
        "DRAW_SHAPE",
        drawShapeEntities(candidate),
        "context_graphics_create_drawing",
        0.88,
      );
    }
  }

  return null;
}

/** Upgrade misclassified TYPE_TEXT when prior clause opened a graphics app. */
function applyContextBoost(
  rec: ClauseRecord,
  ctx: ClassifierContext,
): ClauseRecord {
  if (rec.clauseType !== "TYPE_TEXT") return rec;
  const priorApp = priorLaunchAppId(ctx);
  if (!priorApp || !GRAPHICS_APP_IDS.has(priorApp)) return rec;

  const candidate = normalizeDrawClause(rec.normalized);
  const typeText = rec.entities.typeText ?? "";
  const drawCandidate = normalizeDrawClause(typeText);
  const probe = /\b(?:draw|sketch)\b/i.test(candidate)
    ? candidate
    : drawCandidate;

  if (!/\b(?:draw|sketch)\b/i.test(probe)) return rec;

  const shape = shapeFromDrawText(probe);
  if (!shape) return rec;

  return record(
    rec.index,
    rec.raw,
    rec.normalized,
    "DRAW_SHAPE",
    { drawShape: shape },
    "context_boost_type_to_draw",
    0.9,
  );
}

/** Explicit spoken target ("on youtube" / "on google") overrides live context. */
function explicitSearchEngine(command: string): "youtube" | "google" | undefined {
  if (/\b(?:on|in|at|using|via)\s+youtube\b/i.test(command)) return "youtube";
  if (/\b(?:on|in|at|using|via)\s+(?:google|the\s+web|internet|browser|chrome)\b/i.test(command)) {
    return "google";
  }
  return undefined;
}

function classifySearchClause(
  normalized: string,
  ctx: ClassifierContext,
): ClauseRecord | null {
  const explicit = explicitSearchEngine(normalized);
  const priorWs = priorWorkspaceId(ctx);
  // Priority: explicit user target > current site/context.
  const contextIsYouTube = explicit ? explicit === "youtube" : priorWs === "youtube";

  const media = parseMediaWorkspaceSearch(normalized);
  if (media) {
    const engine =
      explicit ?? (priorWs === "youtube" || !priorWs ? "youtube" : "google");
    return record(0, normalized, normalized, "MEDIA_SEARCH", {
      searchQuery: media.query,
      searchEngine: engine as "youtube" | "google",
    }, explicit ? "explicit_target" : "parseMediaWorkspaceSearch", 0.9);
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
    if (contextIsYouTube) {
      return record(0, normalized, normalized, "MEDIA_SEARCH", {
        searchQuery: web.query,
        searchEngine: "youtube",
      }, explicit ? "explicit_target=youtube" : "context_youtube_search", 0.88);
    }
    return record(0, normalized, normalized, "WEB_SEARCH", {
      searchQuery: web.query,
      searchEngine: "google",
    }, explicit === "google" ? "explicit_target=google" : "parseBrowserWorkspaceSearch", 0.88);
  }

  if (/^\s*search\b/i.test(normalized)) {
    const m = normalized.match(/^\s*search\s+(?:for\s+)?(.+?)\s*$/i);
    const q = m?.[1]?.trim();
    if (q) {
      if (contextIsYouTube) {
        return record(0, normalized, normalized, "MEDIA_SEARCH", {
          searchQuery: q,
          searchEngine: "youtube",
        }, explicit ? "explicit_target=youtube" : "context_youtube_fallback", 0.75);
      }
      return record(0, normalized, normalized, "WEB_SEARCH", {
        searchQuery: q,
        searchEngine: "google",
      }, explicit === "google" ? "explicit_target=google" : "search_fallback", 0.7);
    }
  }

  return null;
}

function tryClassifyClipboard(
  index: number,
  raw: string,
  normalized: string,
): ClauseRecord | null {
  const clip = parseClipboardCommand(raw);
  if (!clip) return null;
  return record(
    index,
    raw,
    normalized,
    "CLIPBOARD_OP",
    {
      clipOp: clip.op,
      ...(clip.text ? { clipText: clip.text } : {}),
    },
    "parseClipboardCommand",
    0.92,
  );
}

function tryClassifyPaintOp(
  index: number,
  raw: string,
  normalized: string,
  ctx: ClassifierContext,
): ClauseRecord | null {
  const priorApp = priorLaunchAppId(ctx);
  const priorDraw = ctx.priorRecords.some((r) => r.clauseType === "DRAW_SHAPE");
  const inPaint =
    (priorApp && GRAPHICS_APP_IDS.has(priorApp)) || priorDraw;
  if (!inPaint) return null;

  if (/^\s*fill(?:\s+(?:the\s+)?(?:shape|it))?\s*$/i.test(normalized)) {
    return record(index, raw, normalized, "PAINT_OP", { paintOp: "fill" }, "paint_fill", 0.9);
  }
  if (/^\s*erase(?:\s+(?:the\s+)?(?:shape|it))?\s*$/i.test(normalized)) {
    return record(index, raw, normalized, "PAINT_OP", { paintOp: "erase" }, "paint_erase", 0.88);
  }
  if (/^\s*clear\s+(?:the\s+)?canvas\s*$/i.test(normalized)) {
    return record(index, raw, normalized, "PAINT_OP", { paintOp: "clear" }, "paint_clear", 0.9);
  }
  const label = normalized.match(/^\s*label(?:\s+it)?(?:\s+(.+?))?\s*$/i);
  if (label) {
    const text = label[1]?.trim() || "label";
    return record(
      index,
      raw,
      normalized,
      "PAINT_OP",
      { paintOp: "label", paintLabel: text },
      "paint_label",
      0.85,
    );
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

  const createInApp = parseCreateFileInAppCommand(normalized);
  if (createInApp) {
    return record(index, raw, normalized, "CREATE_FILE", {
      createFilename: createInApp.filename,
      createApp: createInApp.application,
    }, "parseCreateFileInAppCommand", 0.92);
  }

  const calc = parseCalculatorInput(normalized);
  if (calc) {
    const text = calc.mode === "text" ? calc.text : undefined;
    return record(index, raw, normalized, "TYPE_TEXT", {
      typeText: text ?? String(calc),
    }, "parseCalculatorInput", 0.9);
  }

  const drawShape = tryClassifyDrawShape(index, raw, normalized, ctx);
  if (drawShape) return drawShape;

  const paintOp = tryClassifyPaintOp(index, raw, normalized, ctx);
  if (paintOp) return paintOp;

  const contextClose = tryClassifyContextClose(index, raw, normalized, ctx);
  if (contextClose) return contextClose;

  const clipboard = tryClassifyClipboard(index, raw, normalized);
  if (clipboard) return clipboard;

  const input = parseDesktopInputFallback(normalized);
  if (input) {
    if (input.mode === "keys") {
      return record(
        index,
        raw,
        normalized,
        "TYPE_TEXT",
        { keyInput: input.keys },
        "parseDesktopInputFallback",
        0.95,
      );
    }
    if (input.mode === "sequence") {
      return record(
        index,
        raw,
        normalized,
        "TYPE_TEXT",
        { keySequence: input.sequence },
        "parseDesktopInputFallback",
        0.95,
      );
    }
    const intent = desktopInputToTypeIntent(input);
    const typeRec = record(index, raw, normalized, "TYPE_TEXT", {
      typeText: intent.text,
    }, "parseDesktopInputFallback", 0.9);
    return applyContextBoost(typeRec, ctx);
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

  const automation =
    parseAutomationClause(normalized) ?? parseAutomationClause(raw);
  if (automation) {
    return record(
      index,
      raw,
      normalized,
      "AUTOMATION",
      {
        automationKind: automation.kind,
        ...(automation.path ? { automationPath: automation.path } : {}),
        ...(automation.projectHint
          ? { automationProjectHint: automation.projectHint }
          : {}),
        ...(automation.query ? { automationQuery: automation.query } : {}),
        ...(automation.projectRoot
          ? { automationProjectRoot: automation.projectRoot }
          : {}),
        ...(automation.kind === "run_command"
          ? { automationQuery: automation.command }
          : {}),
      },
      "parseAutomationClause",
      0.9,
    );
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
  ctx?: Omit<ClassifierContext, "priorRecords">,
): ClauseRecord[] {
  const records: ClauseRecord[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = classifyClause(parts[i]!, i, {
      priorRecords: records,
      activeWorkspaceId: ctx?.activeWorkspaceId,
    });
    records.push(rec);
  }
  return records;
}
