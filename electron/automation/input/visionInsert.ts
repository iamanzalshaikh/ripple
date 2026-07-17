import { clipboard } from "electron";
import { delay } from "../delay.js";
import { resolveTypingFocusTarget } from "../../focus/focusContext.js";
import { pasteFromClipboard } from "../keyboard.js";
import {
  screenshotOcrNative,
  mouseClickNative,
  getWindowRectCenter,
} from "../../native/win32Bridge.js";
import { detectElementOnScreen } from "../ai/aiHelpers.js";

export function visionInsertEnabled(): boolean {
  return process.env.RIPPLE_P85_VISION_INSERT !== "0";
}

/**
 * P8.5-P5.2 vision fallback — OCR snapshot, click editor region, paste text.
 * P5.5: prefer `ai.detect_element` heuristics when a hint is available.
 * Used only after UIA + SendKeys + clipboard paste fail.
 */
export async function runVisionInsert(
  text: string,
  options?: { elementHint?: string },
): Promise<boolean> {
  if (!visionInsertEnabled()) return false;
  const focus = resolveTypingFocusTarget();
  if (!focus?.hwnd) return false;

  const ocr = await screenshotOcrNative({ hwnd: focus.hwnd });
  void ocr?.text;

  let clickX: number;
  let clickY: number;

  const hint = options?.elementHint?.trim();
  if (hint) {
    const detected = await detectElementOnScreen({
      query: hint,
      hwnd: focus.hwnd,
    });
    if (detected.found) {
      clickX = detected.x;
      clickY = detected.y;
      console.info(
        `[ripple-p85] vision insert via detect_element "${hint}" @ ${clickX},${clickY}`,
      );
    } else {
      const center = await getWindowRectCenter(focus.hwnd);
      if (!center) return false;
      clickX = center.x;
      clickY = center.y + 80;
    }
  } else {
    const center = await getWindowRectCenter(focus.hwnd);
    if (!center) return false;
    clickX = center.x;
    clickY = center.y + 80;
  }

  const clicked = await mouseClickNative({
    x: Math.round(clickX),
    y: Math.round(clickY),
    button: "left",
  });
  if (!clicked?.ok) return false;

  await delay(200);
  clipboard.writeText(text);
  await delay(80);
  await pasteFromClipboard();
  return true;
}
