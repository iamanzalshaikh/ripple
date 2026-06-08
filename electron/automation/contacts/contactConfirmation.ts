import { dialog } from "electron";
import type { ContactMatchResult } from "./contactMatch.js";

/**
 * User confirmation before messaging — prevents wrong-person sends.
 */
export async function resolveContactWithUser(
  match: ContactMatchResult,
): Promise<string | null> {
  const { tier, best, transcript, candidates } = match;

  if (tier === "auto") {
    return best.name;
  }

  if (tier === "confirm") {
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Ripple — confirm contact",
      message: `Message ${best.name}?`,
      detail: `Heard: "${transcript}"\nMatch: ${best.name} (${best.confidence}% confidence)`,
      buttons: ["Yes, continue", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    return response === 0 ? best.name : null;
  }

  const picks = candidates
    .filter((c) => c.source !== "transcript")
    .slice(0, 3);
  const names =
    picks.length > 0 ? picks.map((c) => c.name) : candidates.slice(0, 3).map((c) => c.name);

  const buttons = [...names, "Cancel"];
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Ripple — who did you mean?",
    message: `Heard: "${transcript}" (${best.confidence}% on best guess)`,
    detail: "Pick the correct contact:",
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });

  if (response === buttons.length - 1 || response < 0) {
    return null;
  }
  return names[response] ?? null;
}
