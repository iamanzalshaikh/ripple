import { describe, expect, it } from "vitest";
import {
  applyScreenNameBias,
  editDistance,
  extractCandidateTerms,
} from "../screenNameBias.js";

describe("Phase 7.7 — screen name bias", () => {
  it("editDistance is zero for identical strings", () => {
    expect(editDistance("tathir", "tathir")).toBe(0);
  });

  it("editDistance counts substitutions", () => {
    expect(editDistance("tatheer", "tathir")).toBe(2);
  });

  it("extractCandidateTerms pulls capitalized names and skips UI chrome", () => {
    const terms = extractCandidateTerms(
      "Chats\nMessages\nAmaal Ahamed\nType a message\nWhatsApp\nTathir",
    );
    expect(terms.some((t) => /amaal/i.test(t))).toBe(true);
    expect(terms.some((t) => /tathir/i.test(t))).toBe(true);
    expect(terms.map((t) => t.toLowerCase())).not.toContain("chats");
    expect(terms.map((t) => t.toLowerCase())).not.toContain("whatsapp");
  });

  it("applyScreenNameBias fixes a near-miss spelling toward the on-screen name", () => {
    const res = applyScreenNameBias("Hey Tatheer, how are you?", ["Tathir"]);
    expect(res.text).toBe("Hey Tathir, how are you?");
    expect(res.replacements).toEqual([{ from: "Tatheer", to: "Tathir" }]);
  });

  it("applyScreenNameBias normalizes casing when the name is already correct", () => {
    const res = applyScreenNameBias("hello tathir", ["Tathir"]);
    expect(res.text).toBe("hello Tathir");
  });

  it("applyScreenNameBias does not rewrite unrelated common words", () => {
    const res = applyScreenNameBias("Please send the message today", [
      "Tathir",
      "Amaal",
    ]);
    expect(res.text).toBe("Please send the message today");
    expect(res.replacements).toEqual([]);
  });

  it("never biases like→Liked or all→All from Instagram UI chrome", () => {
    const terms = extractCandidateTerms("Liked\nSeen\nAll\nMessage...\nTathir");
    expect(terms.map((t) => t.toLowerCase())).not.toContain("liked");
    expect(terms.map((t) => t.toLowerCase())).not.toContain("all");
    const res = applyScreenNameBias(
      "It's like when I want to text someone from like last days",
      ["Liked", "All", "Tathir"],
    );
    expect(res.text.toLowerCase()).toContain("like");
    expect(res.text).not.toMatch(/\bLiked\b/);
    expect(res.replacements.every((r) => r.to.toLowerCase() !== "liked")).toBe(
      true,
    );
  });

  it("applyScreenNameBias prefers multi-word screen names", () => {
    const res = applyScreenNameBias("Message Amal Ahmed please", [
      "Amaal Ahamed",
    ]);
    // Individual parts may match; at least one correction toward screen form
    expect(res.replacements.length).toBeGreaterThan(0);
    expect(res.text.toLowerCase()).toContain("amaal");
  });
});
