import { getFocusContext, restoreFocusContext } from "../focus/focusContext.js";
import { runCopyText } from "./actions/copyText.js";
import { runInsertText } from "./actions/insertText.js";
import { runOpenApp, runOpenUrl } from "./actions/openApp.js";
import { parseWorkflowSteps, runShowSuggestions } from "./actions/showSuggestions.js";
import { delay } from "./delay.js";
import type { RippleAction } from "./types.js";

/** Run a single action (WORKFLOW runs inner steps, no nested WORKFLOW expansion). */
export async function executeSingleAction(action: RippleAction): Promise<string> {
  switch (action.type) {
    case "NOOP":
      return "No action required";

    case "OPEN_APP": {
      const detail = await runOpenApp(action.data);
      await delayAfterOpen();
      return detail;
    }

    case "OPEN_URL": {
      const detail = await runOpenUrl(action.data);
      await delayAfterOpen();
      return detail;
    }

    case "COPY_TEXT":
      return runCopyText(action.data);

    case "INSERT_TEXT":
      return runInsertText(action.data);

    case "SHOW_SUGGESTIONS":
      return runShowSuggestions(action.data);

    case "WORKFLOW": {
      const steps = optimizeWorkflowSteps(parseWorkflowSteps(action));
      if (steps.length === 0) {
        throw new Error("WORKFLOW has no steps");
      }
      const details: string[] = [];
      for (const step of steps) {
        if (step.type === "WORKFLOW") {
          throw new Error("Nested WORKFLOW is not supported");
        }
        details.push(await executeSingleAction(step));
      }
      return details.join(" → ");
    }

    default:
      throw new Error(`Unknown action type: ${String(action.type)}`);
  }
}

/**
 * Gmail workflow: OPEN_APP + INSERT_TEXT → only INSERT_TEXT (compose URL has everything).
 * Avoids empty compose tab then failed paste.
 */
function optimizeWorkflowSteps(steps: RippleAction[]): RippleAction[] {
  if (steps.length < 2) return steps;

  const first = steps[0];
  const hasInsert = steps.some((s) => s.type === "INSERT_TEXT");
  const target =
    typeof first?.data?.target === "string"
      ? first.data.target.toLowerCase()
      : "";

  if (
    first?.type === "OPEN_APP" &&
    target === "gmail" &&
    hasInsert
  ) {
    console.info(
      "[ripple-desktop] WORKFLOW: skip OPEN_APP — INSERT_TEXT opens pre-filled Gmail compose",
    );
    return steps.filter((s) => s.type !== "OPEN_APP");
  }

  return steps;
}

/** After OPEN_* in a workflow, wait then return focus to pre-voice window (e.g. Gmail compose). */
async function delayAfterOpen(): Promise<void> {
  const ctx = getFocusContext();
  if (ctx?.isGmail || ctx?.isWhatsApp || ctx?.isSlack) {
    await delay(400);
    await restoreFocusContext();
    return;
  }
  await delay(ctx ? 1200 : 800);
}
