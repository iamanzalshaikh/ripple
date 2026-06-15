import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { dialog } from "electron";
import { resolveFolderPath } from "./openFolder.js";
import { searchItemsByName } from "./searchFiles.js";

function resolveParentPath(name?: string): string {
  if (!name?.trim()) return resolveFolderPath("desktop");
  const key = name.trim().toLowerCase();
  if (key.startsWith("download")) return resolveFolderPath("downloads");
  if (key.startsWith("document")) return resolveFolderPath("documents");
  if (key === "desktop") return resolveFolderPath("desktop");
  return name;
}

function formatChoiceLabel(path: string): string {
  const name = basename(path);
  const parent = path.replace(/[/\\][^/\\]+$/, "");
  return `${name} — ${parent}`;
}

async function pickItemWhenAmbiguous(
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

/**
 * Resolve spoken name to a file or folder path.
 * Uses optional folder hint, then search, then disambiguation dialog.
 */
export async function resolveItemBySpokenName(
  spoken: string,
  parent?: string,
): Promise<string> {
  const trimmed = spoken.trim();
  if (!trimmed) {
    throw new Error("No file or folder name given");
  }

  if (/[\\/]/.test(trimmed) && existsSync(trimmed)) {
    return trimmed;
  }

  if (parent) {
    const parentPath = resolveParentPath(parent);
    const direct = join(parentPath, trimmed);
    if (existsSync(direct)) return direct;
  }

  const matches = searchItemsByName(trimmed);
  if (matches.length === 0) {
    const hint = parent ? ` in ${parent}` : "";
    throw new Error(
      `Not found: "${trimmed}"${hint} (searched Downloads, Documents, Desktop — say e.g. "Rename Flow in Downloads to Heroids")`,
    );
  }

  if (matches.length === 1) {
    console.info(`[ripple-desktop] Resolved "${trimmed}" → ${matches[0]}`);
    return matches[0]!;
  }

  const picked = await pickItemWhenAmbiguous(trimmed, matches);
  if (!picked) {
    throw new Error("Cancelled — pick which file or folder you meant");
  }

  console.info(`[ripple-desktop] Resolved "${trimmed}" → ${picked} (user picked)`);
  return picked;
}
