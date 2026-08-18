import { describe, expect, it } from "vitest";
import {
  applyCorrectionHeuristics,
  applyStyleTone,
  parseSpokenStyleInstruction,
} from "../correctionEngine.js";
import { parseStyleTone } from "../../../storage/styleTone.js";

describe("Wispr style scale", () => {
  it("parses stored ids including legacy three-tone values", () => {
    expect(parseStyleTone("casual")).toBe("casual");
    expect(parseStyleTone("professional")).toBe("professional");
    expect(parseStyleTone("neutral")).toBe("neutral");
    expect(parseStyleTone("very_casual")).toBe("very_casual");
    expect(parseStyleTone("formal")).toBe("formal");
    expect(parseStyleTone("not-a-tone")).toBe("neutral");
  });

  it("maps spoken rewrite instructions onto the scale", () => {
    expect(parseSpokenStyleInstruction("make this very casual")).toBe(
      "very_casual",
    );
    expect(parseSpokenStyleInstruction("make it casual")).toBe("casual");
    expect(parseSpokenStyleInstruction("make it professional")).toBe(
      "professional",
    );
    expect(parseSpokenStyleInstruction("make this more formal")).toBe("formal");
    expect(parseSpokenStyleInstruction("turn this into a haiku")).toBeNull();
  });

  it("applies very casual vs formal without changing meaning", () => {
    expect(applyStyleTone("Hello I would like to go", "very_casual")).toBe(
      "Hey I wanna go",
    );
    expect(applyStyleTone("hey gotta ship this", "formal")).toMatch(
      /^Hello must ship this\.?$/i,
    );
    expect(applyStyleTone("hey gotta ship this", "professional")).toMatch(
      /need to/i,
    );
    expect(applyStyleTone("as spoken", "neutral")).toBe("as spoken");
  });

  it("spoken 'make it professional' still rewrites the buffer", () => {
    const result = applyCorrectionHeuristics(
      "hey gotta ship this make it professional",
    );
    expect(result.kind).toBe("tone_rewrite");
    expect(result.detail).toBe("professional");
    expect(result.text.toLowerCase()).toContain("need to");
  });

  it("spoken 'make this more formal' is Formal, not Professional", () => {
    const result = applyCorrectionHeuristics(
      "hey gotta ship this make this more formal",
    );
    expect(result.kind).toBe("tone_rewrite");
    expect(result.detail).toBe("formal");
    expect(result.text.toLowerCase()).toContain("must");
  });
});
