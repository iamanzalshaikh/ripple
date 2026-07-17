import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { P5_QA_MATRIX } from "./p5-qa-matrix-fixtures.js";

describe("export P5 QA cases for OS UI runner", () => {
  it("writes scripts/p5-qa-matrix-cases.json", () => {
    const out = join(process.cwd(), "scripts", "p5-qa-matrix-cases.json");
    writeFileSync(out, JSON.stringify(P5_QA_MATRIX, null, 2), "utf8");
  });
});
