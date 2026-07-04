import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getToolManifest } from "../planner/toolDefinitions.js";

const MANIFEST_DIR = dirname(fileURLToPath(import.meta.url)).replace(
  /__tests__$/,
  "planner",
);

describe("P8.5 tool manifest file", () => {
  it("writes toolManifest.json from registry", () => {
    const manifest = getToolManifest();
    const outPath = join(MANIFEST_DIR, "toolManifest.json");
    writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    expect(manifest.tools.length).toBeGreaterThan(10);
  });
});
