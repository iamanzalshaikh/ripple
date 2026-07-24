import { describe, expect, it } from "vitest";
import {
  detectSpokenList,
  formatSpokenList,
  localCleanup,
} from "../localCleanup.js";

describe("Wispr-Flow Phase 7.1 — local filler/punct/list cleanup", () => {
  it("strips filler words", () => {
    expect(localCleanup("so um I think, uh, we should like go now")).toBe(
      "So I think, we should go now.",
    );
  });

  it("collapses stutter repeats", () => {
    expect(localCleanup("the the report is is ready")).toBe(
      "The report is ready.",
    );
  });

  it("collapses comma-separated stutter repeats (Whisper's usual rendering)", () => {
    expect(
      localCleanup(
        "don't make yourself sick, what, what, what is it, because of the work",
      ),
    ).toBe("Don't make yourself sick, what is it, because of the work.");
  });

  it("collapses a 3x comma-separated repeat down to one word", () => {
    expect(localCleanup("what, what, what is it")).toBe("What is it?");
  });

  it("adds terminal punctuation and capitalizes", () => {
    expect(localCleanup("this is important")).toBe("This is important.");
  });

  it("uses a question mark for interrogative openers", () => {
    expect(localCleanup("can we meet tomorrow")).toBe(
      "Can we meet tomorrow?",
    );
  });

  it("leaves existing terminal punctuation alone", () => {
    expect(localCleanup("is this ready?")).toBe("Is this ready?");
  });

  it("does not detect a list from a single ordinal-ish word", () => {
    expect(detectSpokenList("let's meet next week")).toBeNull();
  });

  it("detects and formats an explicit spoken list", () => {
    const text =
      "I need to do three things. First call the bank. Second buy groceries. Third finish the report.";
    const list = detectSpokenList(text);
    expect(list).not.toBeNull();
    expect(list!.items).toEqual([
      "call the bank",
      "buy groceries",
      "finish the report",
    ]);
    expect(formatSpokenList(list!)).toBe(
      "I need to do three things.\n1. Call the bank.\n2. Buy groceries.\n3. Finish the report.",
    );
  });
});
