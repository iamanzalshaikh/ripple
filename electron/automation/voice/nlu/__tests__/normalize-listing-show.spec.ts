import { describe, expect, it } from "vitest";
import { normalizeForNlu } from "../normalizeIntent.js";

describe("normalizeForNlu listing protection", () => {
  it("keeps show-me file listing phrases (does not rewrite to open)", () => {
    const nlu = normalizeForNlu(
      "Show me all PDF files inside my Downloads.",
    );
    expect(nlu.toLowerCase()).toMatch(/^show\b/);
    expect(nlu.toLowerCase()).not.toMatch(/^open\b/);
  });

  it("still rewrites show-me folder opens to open", () => {
    const nlu = normalizeForNlu("Show me Downloads");
    expect(nlu.toLowerCase()).toMatch(/^open\b/);
  });
});
