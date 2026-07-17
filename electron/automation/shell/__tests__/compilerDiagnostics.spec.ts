import { describe, expect, it } from "vitest";
import {
  formatCompilerReport,
  parseEslintOutput,
  parseTscOutput,
} from "../compilerDiagnostics.js";
import { detectTypecheckCommand, runProjectTypecheck } from "../runTypecheck.js";

describe("compiler diagnostics", () => {
  it("parses tsc file(line,col) format", () => {
    const output = `src/lib/project-content.ts(68,5): error TS1109: Expression expected.`;
    const diags = parseTscOutput(output);
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      file: "src/lib/project-content.ts",
      line: 68,
      column: 5,
      code: "TS1109",
      message: "Expression expected.",
    });
  });

  it("parses tsc file:line:col dash format", () => {
    const output = `src/app/page.tsx:12:3 - error TS2322: Type 'string' is not assignable to type 'number'.`;
    const diags = parseTscOutput(output);
    expect(diags[0]?.code).toBe("TS2322");
    expect(diags[0]?.line).toBe(12);
  });

  it("formats report with fix suggestion for incomplete displayOrder", () => {
    const report = formatCompilerReport({
      title: "TypeScript check",
      command: "npx tsc --noEmit",
      diagnostics: [
        {
          file: "src/lib/project-content.ts",
          line: 68,
          column: 5,
          code: "TS1109",
          message: "Expression expected.",
          source: "typescript",
        },
      ],
      contextLines: new Map([
        [
          "src/lib/project-content.ts",
          Array.from({ length: 68 }, (_, i) =>
            i === 67 ? "    displayOrder: " : "    line",
          ),
        ],
      ]),
    });
    expect(report).toContain("src/lib/project-content.ts");
    expect(report).toContain("Line: 68");
    expect(report).toContain("TS1109");
    expect(report).toContain("displayOrder: 0");
  });

  it("parses eslint compact output", () => {
    const output = `src/foo.ts:10:2: error Missing validation (no-validation)`;
    const diags = parseEslintOutput(output);
    expect(diags[0]?.file).toBe("src/foo.ts");
    expect(diags[0]?.line).toBe(10);
  });
});

describe("runProjectTypecheck integration", () => {
  const JKF_ROOT = "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )";

  it("detects tsc command for Next.js project", () => {
    const cmd = detectTypecheckCommand(JKF_ROOT);
    expect(cmd?.command).toContain("tsc");
  });

  it("finds project-content.ts syntax error on jkf project", async () => {
    const report = await runProjectTypecheck(JKF_ROOT);
    expect(report).toContain("project-content.ts");
    expect(report).toMatch(/Line: 6[89]/);
    expect(report).toContain("TS1109");
  }, 180_000);
});
