import { describe, expect, it } from "vitest";
import { analyzeProjectFiles } from "../analyzeCodebase.js";
import { scanProject } from "../scanProject.js";
import { shouldIgnorePath } from "../projectScan.js";

const JKF_ROOT = "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )";

describe("project analysis tools", () => {
  it("ignores .next and node_modules paths", () => {
    expect(shouldIgnorePath("C:\\proj\\.next\\types\\app\\layout.ts")).toBe(true);
    expect(shouldIgnorePath("C:\\proj\\node_modules\\react\\index.js")).toBe(true);
    expect(shouldIgnorePath("C:\\proj\\src\\lib\\db.ts")).toBe(false);
  });

  it("scans priority files and source areas", async () => {
    const out = await scanProject(JKF_ROOT);
    expect(out).toContain("package.json");
    expect(out).toContain("Skipped dirs:");
    expect(out).not.toContain(".next/types");
  });

  it("reads file contents and reports heuristic issues", () => {
    const issues = analyzeProjectFiles(JKF_ROOT, { maxFiles: 40 });
    expect(issues.length).toBeGreaterThan(0);
    const rels = issues.map((i) => i.rel.replace(/\\/g, "/"));
    expect(rels.some((r) => r.includes("package.json") || r.includes("src/"))).toBe(
      true,
    );
    expect(
      issues.some((entry) =>
        entry.issues.some((line) => /console\.error|test|Prisma|API/i.test(line)),
      ),
    ).toBe(true);
  });
});
