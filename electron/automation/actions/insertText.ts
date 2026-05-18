import { hideOverlay } from "../../windows/overlay.js";
import { smartInsertText } from "../smartInsert.js";

export async function runInsertText(data?: Record<string, unknown>): Promise<string> {
  const text = typeof data?.text === "string" ? data.text : "";
  hideOverlay();
  return smartInsertText(text, data);
}
