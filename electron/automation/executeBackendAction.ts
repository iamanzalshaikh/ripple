import { getFocusContext, restoreFocusContext } from "../focus/focusContext.js";
import { runCopyText } from "./actions/copyText.js";
import { runInsertText } from "./actions/insertText.js";
import { runOpenApp, runOpenUrl } from "./actions/openApp.js";
import { runShowSuggestions } from "./actions/showSuggestions.js";
import { delay } from "./delay.js";
import type { RippleAction } from "./types.js";

/** Run a single backend action (no WORKFLOW). */
export async function executeBackendAction(action: RippleAction): Promise<string> {
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

    case "WORKFLOW":
      throw new Error("WORKFLOW must use runExpandedWorkflow");

    default:
      throw new Error(`Unknown action type: ${String(action.type)}`);
  }
}

async function delayAfterOpen(): Promise<void> {
  const ctx = getFocusContext();
  if (ctx?.isGmail || ctx?.isWhatsApp || ctx?.isSlack) {
    await delay(400);
    await restoreFocusContext();
    return;
  }
  await delay(ctx ? 1200 : 800);
}
