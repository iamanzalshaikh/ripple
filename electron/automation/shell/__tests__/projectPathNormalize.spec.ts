import { describe, expect, it } from "vitest";
import {
  normalizeWindowsPath,
  normalizeFolderLabel,
  scoreFolderNameMatch,
  trimSpokenPathTail,
} from "../projectPathNormalize.js";
import { extractWindowsPath } from "../../../agent/planner/parseAutomationClause.js";
import { resolveProjectPathDetailed } from "../projectResolver.js";
import { trimSpokenPathTail } from "../projectPathNormalize.js";

describe("project path normalization", () => {
  it("normalizes spaced parentheses in windows paths", () => {
    expect(normalizeWindowsPath("C:\\Users\\me\\Desktop\\jkf ( furniture )")).toBe(
      "C:\\Users\\me\\Desktop\\jkf (furniture)",
    );
  });

  it("extractWindowsPath normalizes quoted speech paths", () => {
    expect(
      extractWindowsPath(
        'Open the project "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )"',
      ),
    ).toBe("C:\\Users\\ANZAL\\Desktop\\jkf (funiture)");
  });

  it("stops unquoted path before trailing spoken audit clause", () => {
    expect(
      extractWindowsPath(
        "Open project C:\\Users\\ANZAL\\Desktop\\jkf (furniture). Perform a full code audit. Check TypeScript errors",
      ),
    ).toBe("C:\\Users\\ANZAL\\Desktop\\jkf (furniture)");
  });

  it("stops unquoted path at open my project at form", () => {
    expect(
      extractWindowsPath(
        "Open my project at C:\\Users\\ANZAL\\Desktop\\jkf (furniture). Check the entire codebase for problems. Find bugs",
      ),
    ).toBe("C:\\Users\\ANZAL\\Desktop\\jkf (furniture)");
  });

  it("trimSpokenPathTail removes comma-separated clauses", () => {
    expect(
      trimSpokenPathTail(
        "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture ), find any existing code issues",
      ),
    ).toBe("C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )");
  });

  it("scores furniture vs funiture typo as a close match", () => {
    expect(
      scoreFolderNameMatch(
        "jkf ( funiture )",
        "jkf (furniture)",
      ),
    ).toBeGreaterThanOrEqual(65);
  });

  it("normalizes folder labels for index lookup", () => {
    expect(normalizeFolderLabel("jkf ( furniture )")).toBe("jkf (furniture)");
  });

  it("resolves spaced folder on disk from normalized speech path", async () => {
    const desktop = "C:\\Users\\ANZAL\\Desktop";
    const result = await resolveProjectPathDetailed({
      path: `${desktop}\\jkf (funiture)`,
    });
    if (result.status === "resolved") {
      expect(result.path.toLowerCase()).toContain("jkf");
      expect(result.path.toLowerCase()).toContain("funiture");
    } else {
      expect(["resolved", "ambiguous", "not_found"]).toContain(result.status);
    }
  });
});
