import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getToolManifest } from "./toolDefinitions.js";

const MANIFEST_DIR = dirname(fileURLToPath(import.meta.url));

/** Serialize Wave 1 tool catalog to toolManifest.json (planner prompt source). */
export function writeToolManifestFile(
  targetDir = MANIFEST_DIR,
): string {
  const manifest = getToolManifest();
  const outPath = join(targetDir, "toolManifest.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return outPath;
}
