import { executeBackendAction } from "../executeBackendAction.js";
import { runNotionBatch } from "../adapters/notion/runNotionAction.js";
import { runYouTubeBatch } from "../adapters/youtube/runYouTubeAction.js";
import { runLinkedInBatch } from "../adapters/linkedin/runLinkedInAction.js";
import { runInstagramBatch } from "../adapters/instagram/runInstagramAction.js";
import { runDesktopOpenBatch } from "../desktop/runDesktopAction.js";
import { runLocalAction, runWhatsAppLocalBatch } from "../actions/local/runLocalAction.js";
import type { WorkflowStep } from "../localTypes.js";
import type { RippleAction } from "../types.js";
import { expandWorkflowSteps } from "./actionExpander.js";

export async function runExpandedWorkflow(steps: RippleAction[]): Promise<string> {
  const expanded = expandWorkflowSteps(steps);
  const details: string[] = [];

  for (const step of expanded) {
    if (step.kind === "backend") {
      // Notion local workflows encode a single NOOP step with `_notionBatch`.
      // In some codepaths the batch payload can be nested under `data.data`.
      const notionBatchData =
        step.action.type === "NOOP" && step.action.data
          ? step.action.data?._notionBatch === true
            ? step.action.data
            : (step.action.data as Record<string, unknown>)?.data?._notionBatch === true
              ? ((step.action.data as Record<string, unknown>).data as Record<
                  string,
                  unknown
                >)
              : null
          : null;

      const youtubeBatchData =
        step.action.type === "NOOP" && step.action.data
          ? step.action.data?._youtubeBatch === true
            ? step.action.data
            : (step.action.data as Record<string, unknown>)?.data?._youtubeBatch === true
              ? ((step.action.data as Record<string, unknown>).data as Record<
                  string,
                  unknown
                >)
              : null
          : null;

      const linkedinBatchData =
        step.action.type === "NOOP" && step.action.data
          ? step.action.data?._linkedinBatch === true
            ? step.action.data
            : (step.action.data as Record<string, unknown>)?.data?._linkedinBatch === true
              ? ((step.action.data as Record<string, unknown>).data as Record<
                  string,
                  unknown
                >)
              : null
          : null;

      const instagramBatchData =
        step.action.type === "NOOP" && step.action.data
          ? step.action.data?._instagramBatch === true
            ? step.action.data
            : (step.action.data as Record<string, unknown>)?.data?._instagramBatch === true
              ? ((step.action.data as Record<string, unknown>).data as Record<
                  string,
                  unknown
                >)
              : null
          : null;

      if (notionBatchData) {
        details.push(await runNotionBatch(notionBatchData));
      } else if (youtubeBatchData) {
        details.push(await runYouTubeBatch(youtubeBatchData));
      } else if (linkedinBatchData) {
        details.push(await runLinkedInBatch(linkedinBatchData));
      } else if (instagramBatchData) {
        details.push(await runInstagramBatch(instagramBatchData));
      } else {
        details.push(await executeBackendAction(step.action));
      }
      continue;
    }

    const local = step.action;
    if (
      local.type === "SEARCH_CONTACT" &&
      local.data?._whatsappBatch === true
    ) {
      details.push(await runWhatsAppLocalBatch(local.data));
      continue;
    }

    if (local.data?._desktopBatch === true) {
      details.push(await runDesktopOpenBatch(local.data));
      continue;
    }

    if (local.data?._notionBatch === true) {
      details.push(await runNotionBatch(local.data));
      continue;
    }

    if (local.data?._youtubeBatch === true) {
      details.push(await runYouTubeBatch(local.data));
      continue;
    }

    if (local.data?._linkedinBatch === true) {
      details.push(await runLinkedInBatch(local.data));
      continue;
    }

    if (local.data?._instagramBatch === true) {
      details.push(await runInstagramBatch(local.data));
      continue;
    }

    details.push(await runLocalAction(local));
  }

  return details.join(" → ");
}
