import {
  getSearchRootKeys,
  resolveSearchRootPath,
} from "../../storage/indexConfig.js";

/** Absolute folder paths used by Windows Search + disk fallback (P5.2). */
export function getRetrieverSearchPaths(): string[] {
  const paths: string[] = [];
  for (const key of getSearchRootKeys()) {
    try {
      paths.push(resolveSearchRootPath(key));
    } catch {
      /* skip invalid root */
    }
  }
  return paths;
}

export function psEscapePath(path: string): string {
  return path.replace(/'/g, "''");
}

/** PowerShell array literal of quoted search roots. */
export function powershellSearchRootsLiteral(): string {
  const paths = getRetrieverSearchPaths().map((p) => `'${psEscapePath(p)}'`);
  return paths.length > 0 ? paths.join(",") : "''";
}
