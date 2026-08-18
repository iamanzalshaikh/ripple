import { describe, expect, it } from "vitest";
import { inferCleanupTags } from "../cleanupTags";

describe("inferCleanupTags", () => {
  it("flags fillers without changing input", () => {
    expect(
      inferCleanupTags({ original: "um so the report is ready" }),
    ).toEqual(["filler"]);
  });

  it("flags stutter repetitions", () => {
    expect(
      inferCleanupTags({ original: "the the launch slipped" }),
    ).toEqual(["repetition"]);
  });

  it("flags spoken self-corrections", () => {
    expect(
      inferCleanupTags({ original: "meet at 5 actually 6pm" }),
    ).toEqual(["correction"]);
  });

  it("flags correctionKind from the existing pipeline", () => {
    expect(
      inferCleanupTags({
        original: "send it tomorrow",
        correctionKind: "double_no",
      }),
    ).toEqual(["correction"]);
  });

  it("can show all three chips together", () => {
    expect(
      inferCleanupTags({
        original: "um the the launch is Friday no no Monday",
        correctionKind: "double_no",
      }),
    ).toEqual(["filler", "repetition", "correction"]);
  });
});
