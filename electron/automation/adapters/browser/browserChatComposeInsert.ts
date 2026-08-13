import { captureObservation } from "../../../agent/observe.js";
import { prepareDictationInsertFocus } from "../../../focus/focusContext.js";
import { runInsertWithFallback } from "../../input/inputStrategy.js";

/**
 * OS-first insert for web chat composers (Google Chat, Slack in browser, …).
 * Uses UIA composer click + clipboard paste — avoids blind window-center clicks
 * and sendkeys double-type on contenteditable fields.
 */
export async function insertBrowserChatComposeText(text: string): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error("No message text for browser chat compose");

  if (!(await prepareDictationInsertFocus())) {
    throw new Error(
      "insert_aborted:no_focus_target — click the chat field and try again",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 200));

  const beforeObserve = await captureObservation();
  const result = await runInsertWithFallback(body, {
    verify: process.env.RIPPLE_P85_INSERT_VERIFY !== "0",
    beforeObserve,
    includeVision: false,
    acceptUnverifiableEdit: true,
    preferFirst: "clipboard_paste",
    abortLadderOnPartialNativeFail: true,
  });
  console.info(
    `[ripple-insert] surface=browser_chat strategy=${result.strategy} status=ok`,
  );
  return result.detail;
}
