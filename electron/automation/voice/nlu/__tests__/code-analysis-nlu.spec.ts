import { describe, expect, it } from "vitest";
import { preprocessForNlu } from "../preprocess.js";
import { normalizeForNlu } from "../normalizeIntent.js";
import { isCodeAnalysisUtterance } from "../codeAnalysisIntent.js";

describe("code analysis NLU", () => {
  it("does not rewrite find code issues to open my", () => {
    const raw = "Find any existing code issues in this project";
    expect(isCodeAnalysisUtterance(raw)).toBe(true);
    const nlu = normalizeForNlu(raw);
    expect(nlu.toLowerCase()).toMatch(/find/);
    expect(nlu.toLowerCase()).not.toMatch(/open my any existing/);
  });

  it("does not rewrite find elements on screen to open my", () => {
    const raw = "Find important elements on this screen";
    const nlu = normalizeForNlu(raw);
    expect(nlu.toLowerCase()).toMatch(/find/);
    expect(nlu.toLowerCase()).not.toMatch(/^open my/);
  });

  it("repairs corrupted open my code issues back to find", () => {
    const out = preprocessForNlu(
      'Open the project "C:\\Users\\me\\Desktop\\jkf", find any existing code issues',
    );
    expect(out.nlu.toLowerCase()).toMatch(/find any existing code issues/);
    expect(out.nlu.toLowerCase()).not.toMatch(/open my any existing code issues/);
  });
});
