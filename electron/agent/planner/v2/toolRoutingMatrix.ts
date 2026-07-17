import { resolveTabTargetFromWorkspace } from "../../../automation/browser/browserTabResolver.js";
import { buildBrowserSearchUrl } from "../../../automation/browser/parseBrowserWorkspaceSearch.js";
import { buildYouTubeSearchUrl } from "../../../automation/browser/parseMediaWorkspaceSearch.js";
import { parseFileOperationCommand } from "../../../automation/desktop/parseFileOperationCommand.js";
import { findWorkspaceById } from "../../../automation/desktop/workspaceRegistry.js";
import { planStepsForCreateFileInApp } from "../planCreateFileInApp.js";
import { automationIntentToPlanSteps } from "../automationIntentToPlanSteps.js";
import { parseAutomationClause } from "../parseAutomationClause.js";
import { fileOpIntentToPlanSteps } from "../l0FileOpPlanner.js";
import type { PlanStep } from "../planTypes.js";
import type { ClauseRecord, ClauseType, RoutingDecision } from "./clauseTypes.js";

const MATRIX: Record<
  ClauseType,
  { tool: string | null; forbidden: string[]; reason: string }
> = {
  APP_LAUNCH: { tool: "desktop.launch_app", forbidden: ["browser."], reason: "launch_app" },
  APP_FOCUS: {
    tool: "desktop.focus_window",
    forbidden: ["browser.", "desktop.launch_app"],
    reason: "switch_app",
  },
  APP_CLOSE: { tool: "desktop.close_window", forbidden: [], reason: "close_app" },
  WORKSPACE_OPEN: {
    tool: "browser.open_workspace",
    forbidden: ["desktop.launch_app"],
    reason: "open_workspace",
  },
  WEB_SEARCH: {
    tool: "browser.search_workspace",
    forbidden: ["desktop.launch_app", "memory.search"],
    reason: "web_search",
  },
  MEDIA_SEARCH: {
    tool: "browser.search_workspace",
    forbidden: ["desktop.launch_app"],
    reason: "media_search",
  },
  FILE_SEARCH: {
    tool: "memory.search",
    forbidden: ["browser.search_workspace"],
    reason: "file_search",
  },
  FOLDER_OPEN: { tool: "filesystem.open", forbidden: ["desktop.launch_app"], reason: "folder_open" },
  FILE_OPEN: { tool: "filesystem.open", forbidden: ["desktop.launch_app"], reason: "file_open" },
  TYPE_TEXT: { tool: "desktop.type_text", forbidden: [], reason: "type_text" },
  CLIPBOARD_OP: { tool: null, forbidden: [], reason: "clipboard_op" },
  DRAW_SHAPE: { tool: "desktop.mouse_drag", forbidden: [], reason: "draw_shape" },
  PAINT_OP: { tool: null, forbidden: [], reason: "paint_op" },
  MOUSE_ACTION: { tool: "desktop.mouse_click", forbidden: [], reason: "mouse_action" },
  SAVE_FILE: { tool: "desktop.save_file", forbidden: [], reason: "save_file" },
  CREATE_FILE: { tool: null, forbidden: [], reason: "create_file" },
  FILE_MUTATE: { tool: null, forbidden: [], reason: "file_mutate" },
  AUTOMATION: { tool: null, forbidden: [], reason: "automation" },
  UNKNOWN: { tool: null, forbidden: ["*"], reason: "unknown" },
};

export function getMatrixEntry(type: ClauseType) {
  return MATRIX[type];
}

function buildSearchUrl(record: ClauseRecord): string {
  const q = record.entities.searchQuery ?? "";
  if (record.entities.searchEngine === "youtube") {
    return buildYouTubeSearchUrl(q);
  }
  return buildBrowserSearchUrl(q);
}

/** L3 — map classified clause to executable plan step. */
export function routeClause(record: ClauseRecord): RoutingDecision | null {
  if (record.status !== "resolved") return null;

  const entry = MATRIX[record.clauseType];
  // FILE_MUTATE and CLIPBOARD_OP resolve tool dynamically.
  if (
    !entry.tool &&
    record.clauseType !== "FILE_MUTATE" &&
    record.clauseType !== "AUTOMATION" &&
    record.clauseType !== "CLIPBOARD_OP" &&
    record.clauseType !== "PAINT_OP" &&
    record.clauseType !== "CREATE_FILE"
  ) {
    return null;
  }

  const blockedTools = [...entry.forbidden];
  const e = record.entities;

  switch (record.clauseType) {
    case "APP_LAUNCH":
    case "APP_FOCUS":
    case "APP_CLOSE":
      if (!e.appId) return null;
      return {
        tool: entry.tool,
        args: { app: e.appId },
        reason: entry.reason,
        blockedTools,
      };
    case "WORKSPACE_OPEN": {
      const url = e.workspaceUrl ?? findWorkspaceById(e.workspaceId ?? "")?.url;
      if (!url) return null;
      const ws = e.workspaceId ? findWorkspaceById(e.workspaceId) : undefined;
      return {
        tool: entry.tool,
        args: {
          workspaceId: e.workspaceId ?? ws?.id ?? "workspace",
          url,
          ...(ws ? { tabTarget: resolveTabTargetFromWorkspace(ws) } : {}),
        },
        reason: entry.reason,
        blockedTools,
      };
    }
    case "WEB_SEARCH":
    case "MEDIA_SEARCH": {
      const query = e.searchQuery?.trim();
      if (!query) return null;
      const url = buildSearchUrl(record);
      return {
        tool: entry.tool,
        args: {
          query,
          url,
          searchEngine: e.searchEngine ?? "google",
          tabTarget: { type: "url", url, label: query },
        },
        reason: entry.reason,
        blockedTools,
      };
    }
    case "FILE_SEARCH": {
      const query = e.searchQuery?.trim();
      if (!query) return null;
      return {
        tool: entry.tool,
        args: {
          query,
          utterance: record.normalized || record.raw,
        },
        reason: entry.reason,
        blockedTools,
      };
    }
    case "FOLDER_OPEN":
      return {
        tool: entry.tool,
        args: { folder: e.folder },
        reason: entry.reason,
        blockedTools,
      };
    case "FILE_OPEN":
      if (e.filename) {
        return {
          tool: entry.tool,
          args: { fileName: e.filename },
          reason: entry.reason,
          blockedTools,
        };
      }
      if (e.itemName) {
        return {
          tool: entry.tool,
          args: {
            itemName: e.itemName,
            ...(e.parentFolder ? { parentFolder: e.parentFolder } : {}),
          },
          reason: entry.reason,
          blockedTools,
        };
      }
      return null;
    case "TYPE_TEXT":
      if (e.keyInput) {
        return {
          tool: "desktop.press_keys",
          args: { keys: e.keyInput },
          reason: "press_keys",
          blockedTools,
        };
      }
      if (e.keySequence?.length) {
        return {
          tool: "desktop.press_keys",
          args: { sequence: e.keySequence },
          reason: "key_sequence",
          blockedTools,
        };
      }
      if (!e.typeText?.trim()) return null;
      return {
        tool: entry.tool,
        args: { text: e.typeText.trim() },
        reason: entry.reason,
        blockedTools,
      };
    case "CLIPBOARD_OP": {
      const op = e.clipOp;
      if (!op) return null;
      if (op === "read") {
        return {
          tool: "system.clipboard.read",
          args: {},
          reason: "read_clipboard",
          blockedTools,
        };
      }
      if (op === "write") {
        const text = e.clipText?.trim();
        if (!text) return null;
        return {
          tool: "system.clipboard.write",
          args: { text },
          reason: "write_clipboard",
          blockedTools,
        };
      }
      if (op === "copy") {
        return {
          tool: "desktop.copy",
          args: {},
          reason: "copy",
          blockedTools,
        };
      }
      if (op === "cut") {
        return {
          tool: "desktop.press_keys",
          args: { keys: "^x" },
          reason: "cut",
          blockedTools,
        };
      }
      if (op === "paste") {
        return {
          tool: "desktop.paste",
          args: {},
          reason: "paste",
          blockedTools,
        };
      }
      if (op === "select_all") {
        return {
          tool: "desktop.select_all",
          args: {},
          reason: "select_all",
          blockedTools,
        };
      }
      if (op === "select_all_copy" || op === "select_all_cut") {
        const cut = op === "select_all_cut";
        return {
          tool: "desktop.press_keys",
          args: {
            sequence: cut
              ? [
                  { type: "keys", value: "^a", delayMs: 80 },
                  { type: "keys", value: "^x", delayMs: 120 },
                ]
              : [
                  { type: "keys", value: "^a", delayMs: 80 },
                  { type: "keys", value: "^c", delayMs: 120 },
                ],
          },
          reason: op,
          blockedTools,
        };
      }
      return null;
    }
    case "PAINT_OP": {
      const op = e.paintOp;
      if (!op) return null;
      if (op === "label") {
        const text = e.paintLabel?.trim();
        if (!text) return null;
        return {
          tool: "desktop.paint_op",
          args: { op: "label", text },
          reason: "paint_label",
          blockedTools,
        };
      }
      return {
        tool: "desktop.paint_op",
        args: { op },
        reason: `paint_${op}`,
        blockedTools,
      };
    }
    case "DRAW_SHAPE": {
      const rawShape = e.drawShape ?? "circle";
      const shape =
        rawShape === "circle" || rawShape === "oval" || rawShape === "circles"
          ? "ellipse"
          : rawShape === "square" ||
              rawShape === "rect" ||
              rawShape === "rectangle" ||
              rawShape === "box"
            ? "rect"
            : rawShape === "line"
              ? "line"
              : rawShape === "star"
                ? "star"
                : rawShape === "triangle"
                  ? "triangle"
                  : rawShape === "heart"
                    ? "heart"
                    : "ellipse";
      const drawCount =
        typeof e.drawCount === "number" && e.drawCount > 1
          ? Math.min(8, e.drawCount)
          : /\bmultiple\b/i.test(record.normalized)
            ? 3
            : 1;
      const steps: PlanStep[] = [];
      for (let i = 0; i < drawCount; i++) {
        const offsetX = i * 36;
        steps.push(
          {
            tool: "desktop.mouse_move",
            args: { moveToCenter: true, offsetX },
            reason: "canvas_center",
          },
          {
            tool: "desktop.mouse_drag",
            args: { shape, radius: 56, moveToCenter: true, offsetX },
            reason: drawCount > 1 ? `draw_shape_${i + 1}` : "draw_shape",
          },
        );
      }
      if (drawCount > 1 && process.env.RIPPLE_P85_PLANNER_V2_TRACE !== "0") {
        console.info(
          `[planner-v2] draw_shape count=${drawCount} shape=${shape} steps=${steps.length}`,
        );
      }
      return {
        tool: "__multi__",
        args: { steps },
        reason: entry.reason,
        blockedTools,
      };
    }
    case "SAVE_FILE":
      if (!e.saveFilename) return null;
      return {
        tool: entry.tool,
        args: {
          filename: e.saveFilename,
          ...(e.saveFolder ? { folder: e.saveFolder } : {}),
        },
        reason: entry.reason,
        blockedTools,
      };
    case "CREATE_FILE": {
      const filename = e.createFilename?.trim();
      const app = e.createApp?.trim();
      if (!filename || !app) return null;
      const steps = planStepsForCreateFileInApp({
        kind: "create_file_in_app",
        filename,
        application: app,
      });
      if (!steps.length) return null;
      if (steps.length === 1) {
        const step = steps[0]!;
        return {
          tool: step.tool,
          args: { ...step.args },
          reason: step.reason ?? entry.reason,
          blockedTools,
        };
      }
      return {
        tool: "__multi__",
        args: { steps },
        reason: entry.reason,
        blockedTools,
      };
    }
    case "AUTOMATION": {
      const intent =
        parseAutomationClause(record.normalized) ??
        parseAutomationClause(record.raw);
      if (!intent) return null;
      const steps = automationIntentToPlanSteps(intent);
      if (!steps.length) return null;
      if (steps.length === 1) {
        const step = steps[0]!;
        return {
          tool: step.tool,
          args: { ...step.args },
          reason: step.reason ?? entry.reason,
          blockedTools,
        };
      }
      return {
        tool: "__multi__",
        args: { steps },
        reason: entry.reason,
        blockedTools,
      };
    }
    case "FILE_MUTATE": {
      const op =
        parseFileOperationCommand(record.normalized) ??
        parseFileOperationCommand(record.raw);
      if (!op) return null;
      const steps = fileOpIntentToPlanSteps(op);
      if (!steps.length) return null;
      if (steps.length === 1) {
        const step = steps[0]!;
        return {
          tool: step.tool,
          args: { ...step.args },
          reason: step.reason ?? entry.reason,
          blockedTools,
        };
      }
      return {
        tool: "__multi__",
        args: { steps },
        reason: entry.reason,
        blockedTools,
      };
    }
    default:
      return null;
  }
}

export function routingToPlanSteps(decision: RoutingDecision): PlanStep[] {
  if (decision.tool === "__multi__" && Array.isArray(decision.args.steps)) {
    return decision.args.steps as PlanStep[];
  }
  return [
    {
      tool: decision.tool,
      args: { ...decision.args },
      reason: decision.reason,
    },
  ];
}

export function routeRecordToSteps(record: ClauseRecord): PlanStep[] | null {
  const decision = routeClause(record);
  if (!decision) return null;
  return routingToPlanSteps(decision);
}
