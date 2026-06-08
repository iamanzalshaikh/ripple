import { openFile, openFolder, resolveFolderPath } from "./openFolder.js";
import { searchFileByName } from "./searchFiles.js";

export async function runDesktopOpenBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const kind = data?.desktopKind;
  if (kind === "folder") {
    const folder =
      typeof data?.folder === "string" ? data.folder : "downloads";
    return openFolder(resolveFolderPath(folder));
  }

  if (kind === "file") {
    const filename = typeof data?.filename === "string" ? data.filename : "";
    if (!filename.trim()) {
      throw new Error("No filename in desktop command");
    }
    const found = searchFileByName(filename);
    if (!found) {
      throw new Error(
        `File not found: "${filename}" (searched Downloads, Documents, Desktop)`,
      );
    }
    console.info(`[ripple-desktop] Desktop file resolved → ${found}`);
    return openFile(found);
  }

  throw new Error("Unknown desktop command kind");
}
