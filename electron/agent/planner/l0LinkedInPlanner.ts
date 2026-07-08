import {
  isLinkedInCommand,
  parseLinkedInCommand,
} from "../../automation/adapters/linkedin/parseLinkedInCommand.js";
import { LINKEDIN_HOME } from "../../automation/adapters/linkedin/openLinkedIn.js";
import { classifyUtterance } from "./utteranceClassifier.js";
import type { ExecutionPlan, L0PlannerResult } from "./planTypes.js";

function isCompoundUtterance(command: string, normalized: string): boolean {
  return classifyUtterance(command, normalized) === "compound";
}

/** Let compound planner handle e.g. "Switch to Chrome and open LinkedIn". */
function skipNonAtomicLinkedInCompound(
  command: string,
  normalized: string,
): boolean {
  if (!isCompoundUtterance(command, normalized)) return false;
  if (/^\s*open\s+(?:the\s+)?linkedin\b/i.test(command)) return false;
  if (
    /^\s*(?:search|find|create|draft|post)\b/i.test(command) &&
    !/^\s*(?:switch|focus|go)\b/i.test(command)
  ) {
    return false;
  }
  return true;
}

/** True when utterance must not go through generic compound / web-search splitters. */
export function isLinkedInPlannerUtterance(
  command: string,
  normalized?: string,
): boolean {
  if (!isLinkedInCommand(command)) return false;
  if (normalized && skipNonAtomicLinkedInCompound(command, normalized)) return false;
  return true;
}

function openWorkspacePlan(
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal: "Open LinkedIn",
    confidence: 0.93,
    steps: [
      {
        tool: "browser.open_workspace",
        args: {
          workspaceId: "linkedin",
          url: LINKEDIN_HOME,
        },
        reason: "linkedin_open",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function linkedInRunPlan(
  rawCommand: string,
  normalized: string,
  kind: "search_people" | "create_post",
  args: Record<string, unknown>,
): ExecutionPlan {
  return {
    goal: `LinkedIn ${kind}`,
    confidence: 0.92,
    steps: [
      {
        tool: "browser.linkedin.run",
        args: {
          kind,
          rawCommand: rawCommand.trim(),
          ...args,
        },
        reason: `linkedin_${kind}`,
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

/**
 * L0 LinkedIn → tool executor (browser.open_workspace | browser.linkedin.run).
 * Replaces legacy orchestrator linkedin-local routers.
 */
export function tryL0LinkedInPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  if (skipNonAtomicLinkedInCompound(rawCommand, normalized)) return null;

  const intent = parseLinkedInCommand(rawCommand);
  if (!intent) return null;

  if (intent.kind === "open") {
    return { kind: "plan", plan: openWorkspacePlan(rawCommand, normalized) };
  }

  if (intent.kind === "search_people") {
    if (!intent.query.trim()) return null;
    return {
      kind: "plan",
      plan: linkedInRunPlan(rawCommand, normalized, "search_people", {
        query: intent.query,
      }),
    };
  }

  if (intent.kind === "create_post") {
    return {
      kind: "plan",
      plan: linkedInRunPlan(rawCommand, normalized, "create_post", {
        text: intent.text ?? "",
        publish: intent.publish,
      }),
    };
  }

  return null;
}
