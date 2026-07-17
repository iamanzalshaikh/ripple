import { describe, expect, it } from "vitest";
import {
  buildCodeRepairPanelPayload,
  explainDiagnostic,
} from "../codeRepairReveal.js";
import type { CompilerDiagnostic } from "../compilerDiagnostics.js";

describe("codeRepairReveal panel payload", () => {
  it("builds panel fields from a TS1109 diagnostic", () => {
    const diag: CompilerDiagnostic = {
      file: "src/lib/project-content.ts",
      line: 69,
      column: 5,
      code: "TS1109",
      message: "Expression expected.",
      source: "typescript",
    };

    expect(explainDiagnostic(diag)).toMatch(/Incomplete object property/i);

    const payload = buildCodeRepairPanelPayload(
      "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )",
      [diag],
    );
    // Project may or may not exist on CI — payload still builds structure.
    expect(payload).not.toBeNull();
    expect(payload!.fileName).toContain("project-content.ts");
    expect(payload!.line).toBe(69);
    expect(payload!.code).toBe("TS1109");
    expect(payload!.message).toBe("Expression expected.");
    expect(payload!.suggestedFix.length).toBeGreaterThan(0);
  });

  it("returns null for empty diagnostics", () => {
    expect(buildCodeRepairPanelPayload("C:\\tmp", [])).toBeNull();
  });
});
