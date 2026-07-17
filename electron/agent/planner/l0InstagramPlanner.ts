import {
  INSTAGRAM_HOME,
} from "../../automation/adapters/instagram/openInstagram.js";
import {
  isInstagramCommand,
  parseInstagramCommand,
} from "../../automation/adapters/instagram/parseInstagramCommand.js";
import { classifyUtterance } from "./utteranceClassifier.js";
import type { ExecutionPlan, L0PlannerResult } from "./planTypes.js";

function isCompoundUtterance(command: string, normalized: string): boolean {
  return classifyUtterance(command, normalized) === "compound";
}

/** Let compound planner handle e.g. "Switch to Chrome and open Instagram". */
function skipNonAtomicInstagramCompound(
  command: string,
  normalized: string,
): boolean {
  if (!isCompoundUtterance(command, normalized)) return false;
  if (/^\s*open\s+(?:the\s+)?(?:instagram|insta|ig)\b/i.test(command)) {
    return false;
  }
  if (
    /^\s*(?:message|dm|text|send|search)\b/i.test(command) &&
    !/^\s*(?:switch|focus|go)\b/i.test(command)
  ) {
    return false;
  }
  return true;
}

/** True when utterance must not go through generic compound / web-search splitters. */
export function isInstagramPlannerUtterance(
  command: string,
  normalized?: string,
): boolean {
  if (!isInstagramCommand(command)) return false;
  if (normalized && skipNonAtomicInstagramCompound(command, normalized)) {
    return false;
  }
  return true;
}

function openWorkspacePlan(
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal: "Open Instagram",
    confidence: 0.93,
    steps: [
      {
        tool: "browser.open_workspace",
        args: {
          workspaceId: "instagram",
          url: INSTAGRAM_HOME,
        },
        reason: "instagram_open",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function instagramRunPlan(
  rawCommand: string,
  normalized: string,
  kind: "message" | "compose",
  args: Record<string, unknown>,
): ExecutionPlan {
  return {
    goal: `Instagram ${kind}`,
    confidence: 0.92,
    steps: [
      {
        tool: "browser.instagram.run",
        args: {
          kind,
          rawCommand: rawCommand.trim(),
          ...args,
        },
        reason: `instagram_${kind}`,
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

/**
 * L0 Instagram → tool executor (browser.open_workspace | browser.instagram.run).
 * Replaces legacy orchestrator instagram-local router.
 */
export function tryL0InstagramPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  if (skipNonAtomicInstagramCompound(rawCommand, normalized)) return null;

  const intent = parseInstagramCommand(rawCommand);
  if (!intent) return null;

  if (intent.kind === "open") {
    return { kind: "plan", plan: openWorkspacePlan(rawCommand, normalized) };
  }

  if (intent.kind === "message") {
    if (!intent.username.trim() || !intent.text.trim()) return null;
    return {
      kind: "plan",
      plan: instagramRunPlan(rawCommand, normalized, "message", {
        username: intent.username,
        text: intent.text,
        send: intent.send,
      }),
    };
  }

  if (intent.kind === "compose") {
    if (!intent.text.trim()) return null;
    return {
      kind: "plan",
      plan: instagramRunPlan(rawCommand, normalized, "compose", {
        text: intent.text,
        send: intent.send,
        pasteOnly: true,
      }),
    };
  }

  return null;
}
