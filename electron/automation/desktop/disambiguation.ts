import { basename } from "node:path";
import { dialog } from "electron";
import {
  cancelPendingDisambiguationPick,
  waitForOverlayPick,
  type DisambiguationItem,
} from "../../windows/disambiguationPick.js";

function formatChoiceLabel(path: string): string {
  const name = basename(path);
  const parent = path.replace(/[/\\][^/\\]+$/, "");
  return `${name} — ${parent}`;
}

async function pickViaDialog(
  spoken: string,
  matches: string[],
): Promise<string | null> {
  const labels = matches.slice(0, 5).map(formatChoiceLabel);
  const buttons = [...labels, "Cancel"];

  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Ripple — which file or folder?",
    message: `Multiple matches for "${spoken}"`,
    detail: matches
      .slice(0, 5)
      .map((p, i) => `${i + 1}. ${p}`)
      .join("\n"),
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });

  if (response < 0 || response >= labels.length) return null;
  return matches[response] ?? null;
}

/** Ask user to pick when multiple files/folders match (overlay + dialog). */
export async function pickItemFromMatches(
  spoken: string,
  matches: string[],
): Promise<string | null> {
  const slice = matches.slice(0, 5);
  if (slice.length === 0) return null;
  if (slice.length === 1) return slice[0] ?? null;

  const items: DisambiguationItem[] = slice.map((path) => ({
    path,
    label: formatChoiceLabel(path),
  }));

  let settled = false;
  return new Promise((resolve) => {
    const finish = (path: string | null) => {
      if (settled) return;
      settled = true;
      cancelPendingDisambiguationPick();
      resolve(path);
    };

    void waitForOverlayPick(spoken, items).then(finish);
    void pickViaDialog(spoken, slice).then(finish);
  });
}
