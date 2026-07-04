import { describe, expect, it } from "vitest";
import {
  isClearTextSequence,
  isCopySequence,
  isCutSequence,
  isNavigationKeys,
  isNavigationSequence,
  isPasteKeys,
  sequenceDelayMs,
} from "../keySequenceHelpers.js";

describe("keySequenceHelpers", () => {
  it("detects paste keys", () => {
    expect(isPasteKeys("^v")).toBe(true);
    expect(isPasteKeys("^V")).toBe(true);
    expect(isPasteKeys("^c")).toBe(false);
  });

  it("detects copy and cut sequences", () => {
    expect(
      isCopySequence([
        { type: "keys", value: "^a" },
        { type: "keys", value: "^c" },
      ]),
    ).toBe(true);
    expect(
      isCutSequence([
        { type: "keys", value: "^a" },
        { type: "keys", value: "^x" },
      ]),
    ).toBe(true);
    expect(isCopySequence([{ type: "keys", value: "^c" }])).toBe(false);
  });

  it("detects clear-text sequences", () => {
    expect(
      isClearTextSequence([
        { type: "keys", value: "^a" },
        { type: "keys", value: "{BACKSPACE}" },
      ]),
    ).toBe(true);
  });

  it("uses longer delays for classic editors", () => {
    expect(sequenceDelayMs("notepad")).toBe(220);
    expect(sequenceDelayMs("chrome")).toBe(160);
  });

  it("detects navigation-only keys", () => {
    expect(isNavigationKeys("{UP}")).toBe(true);
    expect(isNavigationKeys("{END}")).toBe(true);
    expect(isNavigationKeys("^c")).toBe(false);
    expect(
      isNavigationSequence([
        { type: "keys", value: "{UP}" },
        { type: "keys", value: "{UP}" },
      ]),
    ).toBe(true);
    expect(
      isNavigationSequence([
        { type: "keys", value: "{UP}" },
        { type: "keys", value: "^c" },
      ]),
    ).toBe(false);
  });
});
