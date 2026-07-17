import { describe, expect, it } from "vitest";
import { parseSearchTerms } from "../findCode.js";

describe("findCode query parsing", () => {
  it("splits multi-word developer workflow queries into OR terms", () => {
    expect(parseSearchTerms("TODO FIXME error console.error broken_imports")).toEqual([
      "TODO",
      "FIXME",
      "error",
      "console.error",
      "broken",
      "imports",
    ]);
  });

  it("keeps single-term queries intact", () => {
    expect(parseSearchTerms("loginHandler")).toEqual(["loginHandler"]);
  });
});
