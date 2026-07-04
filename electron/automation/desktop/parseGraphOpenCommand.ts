import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import { graphLookup, graphLookupKeys } from "../retriever/graphLookup.js";
import { lookupEntity } from "../../storage/knowledgeGraph.js";
import type { KnowledgeEntity } from "../../storage/knowledgeGraph.js";
import type { NativeCommandIntent } from "./parseNativeCommand.js";
import { findNativeAppById } from "./nativeAppRegistry.js";
import { resolveWorkflowExact } from "./userWorkflows.js";
import { sanitizeSpokenName } from "./spokenName.js";
import type { Candidate } from "../planner/types.js";
import { parseGmailOpenEmailCommand } from "../gmail/parseGmailOpenEmail.js";
import { isJunkRecallPath } from "../retriever/pathRecallFilters.js";

export function intentFromKnowledgeEntity(
  entity: KnowledgeEntity,
  spokenName: string,
): NativeCommandIntent | null {
  switch (entity.type) {
    case "app":
    case "app_role": {
      const app = findNativeAppById(entity.path);
      if (!app) return null;
      return { kind: "launch_app", app, rawName: spokenName };
    }
    case "workflow": {
      const workflow = resolveWorkflowExact(entity.path);
      if (!workflow) return null;
      return {
        kind: "run_workflow",
        workflow,
        spokenName: workflow.name,
      };
    }
    case "project":
    case "folder":
    case "file":
      if (isJunkRecallPath(entity.path)) return null;
      return { kind: "open_resolved", path: entity.path };
    default:
      if (isJunkRecallPath(entity.path)) return null;
      return { kind: "open_resolved", path: entity.path };
  }
}

export function intentFromGraphCandidate(
  hit: Candidate,
  spokenName: string,
): NativeCommandIntent {
  const entity =
    lookupEntity(hit.label) ??
    graphLookupKeys(spokenName)
      .map((k) => lookupEntity(k))
      .find((e) => e !== null);

  if (entity) {
    const fromEntity = intentFromKnowledgeEntity(entity, spokenName);
    if (fromEntity) return fromEntity;
  }

  const app = findNativeAppById(hit.path);
  if (app) {
    return { kind: "launch_app", app, rawName: spokenName };
  }

  return { kind: "open_resolved", path: hit.path };
}

/**
 * P5.5 — "open my project", "open my design app" via knowledge graph (fast path).
 */
export function parseGraphOpenCommand(
  command?: string | null,
): NativeCommandIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  if (parseGmailOpenEmailCommand(cmd)) return null;

  const openMatch = cmd.match(/^\s*open\s+(?:my\s+)?(.+?)\s*\.?\s*$/i);
  if (!openMatch?.[1]) return null;

  const spoken = sanitizeSpokenName(openMatch[1]);
  if (!spoken) return null;

  if (/^(?:mail|email)s?\s+from\b/i.test(spoken)) return null;
  if (/\s+(?:mail|email)s?$/i.test(spoken)) return null;
  if (/(?:mail|email)s?\s+(?:about|on|regarding)\b/i.test(cmd)) return null;

  if (/^(?:downloads?|documents?|desktop)$/i.test(spoken)) return null;

  // P5.5 — "open browser" needs "my"; bare role words are too vague for graph.
  if (
    !/\bmy\b/i.test(cmd) &&
    /^(?:browser|editor|terminal|design\s+app)$/i.test(spoken)
  ) {
    return null;
  }

  for (const key of graphLookupKeys(spoken)) {
    const entity = lookupEntity(key);
    if (entity) {
      const intent = intentFromKnowledgeEntity(entity, spoken);
      if (intent) return intent;
    }
  }

  const hit = graphLookup(spoken);
  if (!hit || isJunkRecallPath(hit.path)) return null;

  return intentFromGraphCandidate(hit, spoken);
}
