import {
  isYouTubeCommand,
  parseYouTubeCommand,
} from "../../automation/adapters/youtube/parseYouTubeCommand.js";
import { YOUTUBE_HOME } from "../../automation/adapters/youtube/searchVideo.js";
import { classifyUtterance } from "./utteranceClassifier.js";
import { resolveRippleContext } from "../context/contextResolver.js";
import { resolveSearchRoute } from "../context/routingRules.js";
import type { ExecutionPlan, L0PlannerResult } from "./planTypes.js";

/** Leading/trailing politeness that must not corrupt query/context extraction. */
const POLITENESS = /^(?:\s*(?:sir|please|hey|ok(?:ay)?|ripple)[\s,]+)+|(?:\s+(?:for\s+me|please|thanks|thank\s+you))+\s*$/gi;

const BARE_SEARCH_PLAY =
  /^\s*(?:search|find|play|watch|look\s+up)\s+(?:for\s+)?(.+?)\s*$/i;

/** Strip politeness modifiers but preserve the core intent + query. */
function stripPoliteness(command: string): string {
  return command.replace(POLITENESS, "").trim();
}

/**
 * Bare "search X" / "play X" while the live context is YouTube → keep it on
 * YouTube via browser.youtube.run instead of falling through to a web search.
 */
function contextualYouTubeQuery(
  cleaned: string,
): { kind: "search" | "play"; query: string } | null {
  if (/\b(?:on|in|at|using|via)\s+(?:google|the\s+web|internet|browser|chrome)\b/i.test(cleaned)) {
    return null;
  }
  const route = resolveSearchRoute(resolveRippleContext(cleaned));
  if (route.workspaceId !== "youtube") return null;

  const m = cleaned.match(BARE_SEARCH_PLAY);
  const query = m?.[1]?.trim();
  if (!query || query.length < 2) return null;
  const kind = /^\s*(?:play|watch)\b/i.test(cleaned) ? "play" : "search";
  return { kind, query };
}

function isCompoundUtterance(command: string, normalized: string): boolean {
  return classifyUtterance(command, normalized) === "compound";
}

/** Let compound planner handle e.g. "Switch to Chrome and open YouTube". */
function skipNonAtomicYouTubeCompound(command: string, normalized: string): boolean {
  if (!isCompoundUtterance(command, normalized)) return false;
  if (/^\s*open\s+(?:the\s+)?youtube\b/i.test(command)) return false;
  if (
    /^\s*(?:search|play|watch|find)\b/i.test(command) &&
    !/^\s*(?:switch|focus|go)\b/i.test(command)
  ) {
    return false;
  }
  return true;
}

/** True when utterance must not go through generic compound / web-search splitters. */
export function isYouTubePlannerUtterance(
  command: string,
  normalized?: string,
): boolean {
  if (!isYouTubeCommand(command)) return false;
  if (normalized && skipNonAtomicYouTubeCompound(command, normalized)) return false;
  return true;
}

function openWorkspacePlan(
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  return {
    goal: "Open YouTube",
    confidence: 0.93,
    steps: [
      {
        tool: "browser.open_workspace",
        args: {
          workspaceId: "youtube",
          url: YOUTUBE_HOME,
        },
        reason: "youtube_open",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function youtubeRunPlan(
  rawCommand: string,
  normalized: string,
  kind: "search" | "play",
  query: string,
): ExecutionPlan {
  return {
    goal: `YouTube ${kind} ${query}`,
    confidence: 0.92,
    steps: [
      {
        tool: "browser.youtube.run",
        args: {
          kind,
          query,
          rawCommand: rawCommand.trim(),
        },
        reason: `youtube_${kind}`,
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

/**
 * L0 YouTube → tool executor (browser.open_workspace | browser.youtube.run).
 * Replaces legacy orchestrator youtube-local routers.
 */
export function tryL0YouTubePlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  // Strip politeness ("Sir,", "please", "for me") up front so it neither looks
  // like a compound clause nor corrupts query/context extraction.
  const cleaned = stripPoliteness(rawCommand);
  const cleanedNorm = stripPoliteness(normalized);
  if (skipNonAtomicYouTubeCompound(cleaned, cleanedNorm)) return null;

  const intent = parseYouTubeCommand(cleaned);
  if (!intent) {
    // Context-aware fallback: bare "search X" while the user is on YouTube.
    if (!isCompoundUtterance(cleaned, cleanedNorm)) {
      const ctxYt = contextualYouTubeQuery(cleaned);
      if (ctxYt) {
        return {
          kind: "plan",
          plan: youtubeRunPlan(rawCommand, normalized, ctxYt.kind, ctxYt.query),
        };
      }
    }
    return null;
  }

  if (intent.kind === "open") {
    return { kind: "plan", plan: openWorkspacePlan(rawCommand, normalized) };
  }

  if (intent.kind === "search" || intent.kind === "play") {
    if (!intent.query.trim()) return null;
    return {
      kind: "plan",
      plan: youtubeRunPlan(rawCommand, normalized, intent.kind, intent.query),
    };
  }

  return null;
}
