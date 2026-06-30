import type { NativeCommandIntent } from "../desktop/parseNativeCommand.js";
import type { SmartSearchQuery } from "../desktop/parseSmartSearchCommand.js";
import type { TimeRangeId } from "./timeRange.js";
import { parseTimeRangeFromText } from "./timeRange.js";
import type { RetrieveInput } from "./retriever.js";
import { retrieveFileCandidates } from "./retriever.js";
import type { Candidate } from "../planner/types.js";

export type PlanRetrieveStep = {
  kind: "open_item" | "smart_search" | "open_file";
  phrase: string;
  token?: string;
  parentFolder?: string;
  extension?: string;
  timeRange?: TimeRangeId;
  lifeEventTopic?: string;
  contactTopic?: string;
};

function smartQueryToRetrieveInput(
  query: SmartSearchQuery,
  label: string,
): RetrieveInput {
  switch (query.type) {
    case "last_downloaded":
      return { phrase: label, token: "download" };
    case "latest_token":
      return { phrase: label, token: query.token };
    case "modified_yesterday":
      return {
        phrase: label,
        extension: query.extension,
        timeRange: "yesterday",
      };
    case "modified_today":
      return {
        phrase: label,
        extension: query.extension ?? "pdf",
        timeRange: "today",
      };
    case "modified_last_week":
      return {
        phrase: label,
        token: query.token,
        extension: query.extension,
        timeRange: "last_week",
      };
    case "modified_3_months_ago":
      return {
        phrase: label,
        token: query.token,
        extension: query.extension,
        timeRange: "3_months_ago",
      };
    case "edited_yesterday":
      return {
        phrase: label,
        token: query.token,
        timeRange: "yesterday",
      };
    case "time_ranged":
      return {
        phrase: query.command,
        extension: query.extension,
        timeRange: query.timeRange ?? parseTimeRangeFromText(query.command) ?? undefined,
        parentFolder: query.parentFolder,
      };
    case "semantic_topic":
      return {
        phrase: query.phrase,
        extension: query.extension,
        lifeEventTopic: query.lifeEventTopic,
        contactTopic: query.contactTopic,
      };
  }
}

/** Map planner / desktop intent → retriever step (P5.1). */
export function planStepFromIntent(
  intent: NativeCommandIntent,
  command: string,
): PlanRetrieveStep | null {
  switch (intent.kind) {
    case "item":
      return {
        kind: "open_item",
        phrase: command,
        token: intent.name,
        parentFolder: intent.parent,
      };
    case "smart_search": {
      const input = smartQueryToRetrieveInput(intent.query, intent.label);
      return {
        kind: "smart_search",
        phrase: command,
        token: input.token,
        extension: input.extension,
        timeRange: input.timeRange,
        parentFolder: input.parentFolder,
        lifeEventTopic: input.lifeEventTopic,
        contactTopic: input.contactTopic,
      };
    }
    case "file":
      return {
        kind: "open_file",
        phrase: command,
        token: intent.filename,
      };
    default:
      return null;
  }
}

export function retrieveInputFromPlanStep(
  step: PlanRetrieveStep,
): RetrieveInput {
  return {
    phrase: step.phrase,
    token: step.token,
    extension: step.extension,
    parentFolder: step.parentFolder,
    timeRange: step.timeRange,
    lifeEventTopic: step.lifeEventTopic,
    contactTopic: step.contactTopic,
  };
}

/** P5.1 — all file opens go through canonical retriever chain. */
export async function retrieveForPlan(
  step: PlanRetrieveStep,
): Promise<Candidate[]> {
  return retrieveFileCandidates(retrieveInputFromPlanStep(step));
}

export async function retrieveForIntent(
  intent: NativeCommandIntent,
  command: string,
): Promise<Candidate[]> {
  const step = planStepFromIntent(intent, command);
  if (!step) return [];
  return retrieveForPlan(step);
}

export { retrieveAppCandidates } from "./retrieveAppCandidates.js";
export { smartQueryToRetrieveInput };
