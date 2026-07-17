import { NOTION_HOME } from "../../automation/adapters/notion/openNotion.js";
import {
  isNotionCommand,
  isNotionSamePageDocCommand,
  parseNotionCommand,
} from "../../automation/adapters/notion/parseNotionCommand.js";
import { classifyUtterance } from "./utteranceClassifier.js";
import type { ExecutionPlan, L0PlannerResult } from "./planTypes.js";

function isCompoundUtterance(command: string, normalized: string): boolean {
  return classifyUtterance(command, normalized) === "compound";
}

/** Let compound planner handle e.g. "Switch to Chrome and open Notion". */
function skipNonAtomicNotionCompound(
  command: string,
  normalized: string,
): boolean {
  if (!isCompoundUtterance(command, normalized)) return false;
  if (/^\s*open\s+(?:the\s+)?notion\b/i.test(command)) return false;
  if (
    /^\s*(?:create|new|paste|place)\b/i.test(command) &&
    !/^\s*(?:switch|focus|go)\b/i.test(command)
  ) {
    return false;
  }
  return true;
}

/** True when utterance must not go through generic compound / web-search splitters. */
export function isNotionPlannerUtterance(
  command: string,
  normalized?: string,
): boolean {
  if (isNotionSamePageDocCommand(command)) return false;
  if (!isNotionCommand(command)) return false;
  if (normalized && skipNonAtomicNotionCompound(command, normalized)) return false;
  return true;
}

function openWorkspacePlan(
  rawCommand: string,
  normalized: string,
  workspace?: string,
): ExecutionPlan {
  return {
    goal: "Open Notion",
    confidence: 0.93,
    steps: [
      {
        tool: "browser.open_workspace",
        args: {
          workspaceId: "notion",
          url: NOTION_HOME,
          ...(workspace ? { workspaceHint: workspace } : {}),
        },
        reason: "notion_open",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function notionRunPlan(
  rawCommand: string,
  normalized: string,
  args: Record<string, unknown>,
): ExecutionPlan {
  return {
    goal: "Notion create page",
    confidence: 0.92,
    steps: [
      {
        tool: "browser.notion.run",
        args: {
          kind: "create_page",
          rawCommand: rawCommand.trim(),
          ...args,
        },
        reason: "notion_create_page",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

/**
 * L0 Notion → tool executor (browser.open_workspace | browser.notion.run).
 * Replaces legacy orchestrator notion-local router.
 * Same-page doc generation stays on backend (parseNotionCommand returns null).
 */
export function tryL0NotionPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  if (isNotionSamePageDocCommand(rawCommand)) return null;
  if (skipNonAtomicNotionCompound(rawCommand, normalized)) return null;

  const intent = parseNotionCommand(rawCommand);
  if (!intent) return null;

  if (intent.kind === "open") {
    return {
      kind: "plan",
      plan: openWorkspacePlan(rawCommand, normalized, intent.workspace),
    };
  }

  if (intent.kind === "create_page") {
    return {
      kind: "plan",
      plan: notionRunPlan(rawCommand, normalized, {
        pasteClipboard: intent.pasteClipboard,
        title: intent.title ?? "",
        body: intent.body ?? "",
        workspace: intent.workspace ?? "",
      }),
    };
  }

  return null;
}
