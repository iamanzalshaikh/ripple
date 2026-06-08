import { clipboard } from "electron";
import { restoreFocusContext } from "../../../focus/focusContext.js";
import { delay } from "../../delay.js";
import { openUrlInBrowser } from "../../openUrl.js";
import { pasteFromClipboard, sendKeyChord } from "../../keyboard.js";
import { shouldSearchYouTubeInActiveTab, YOUTUBE_HOME } from "./searchVideo.js";

export async function openYouTubeInBrowser(): Promise<string> {
  if (shouldSearchYouTubeInActiveTab()) {
    await restoreFocusContext();
    await delay(500);
    await sendKeyChord("^l");
    await delay(250);
    clipboard.writeText(YOUTUBE_HOME);
    await delay(80);
    await pasteFromClipboard();
    await delay(120);
    await sendKeyChord("{ENTER}");
    await delay(800);
    return "Navigated to YouTube in active tab";
  }
  await openUrlInBrowser(YOUTUBE_HOME);
  return "Opened YouTube in browser";
}
