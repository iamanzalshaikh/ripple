import { describe, expect, it } from "vitest";
import {
  applyScreenNameBias,
  editDistance,
  extractCandidateTerms,
  extractTitlePriorityTerms,
  extractRepeatedNamePhrases,
  phoneticKey,
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

  it("extractTitlePriorityTerms recovers WhatsApp / Instagram contact names", () => {
    expect(extractTitlePriorityTerms("Anzal Khan - WhatsApp")).toEqual(
      expect.arrayContaining(["Anzal Khan", "Anzal", "Khan"]),
    );
    expect(extractTitlePriorityTerms("(3) Anzal | Instagram")).toEqual(
      expect.arrayContaining(["Anzal"]),
    );
  });

  it("Ansal→Anzal from on-screen WhatsApp title terms", () => {
    const terms = extractCandidateTerms("Anzal Khan - WhatsApp\nType a message");
    const res = applyScreenNameBias("Hey Ansal, can we talk?", terms);
    expect(res.text).toBe("Hey Anzal, can we talk?");
    expect(res.replacements).toEqual(
      expect.arrayContaining([{ from: "Ansal", to: "Anzal" }]),
    );
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

  it("never biases working→Morning from a chat bubble greeting", () => {
    const terms = extractCandidateTerms(
      "Morning!!!!\nMain chick\nGood morning, where are you?",
    );
    const res = applyScreenNameBias(
      "I hired you and you're not working, bro",
      terms.length ? terms : ["Morning", "Main"],
    );
    expect(res.text.toLowerCase()).toContain("working");
    expect(res.text).not.toMatch(/\bMorning\b/);
    expect(
      res.replacements.every((r) => r.to.toLowerCase() !== "morning"),
    ).toBe(true);
  });

  it("fuzzy bias requires same first letter (Tatheer→Tathir still works)", () => {
    const res = applyScreenNameBias("Hey Tatheer, how are you?", ["Tathir"]);
    expect(res.text).toBe("Hey Tathir, how are you?");
  });

  it("applyScreenNameBias prefers multi-word screen names", () => {
    const res = applyScreenNameBias("Message Amal Ahmed please", [
      "Amaal Ahamed",
    ]);
    expect(res.replacements.length).toBeGreaterThan(0);
    expect(res.text.toLowerCase()).toContain("amaal");
  });
});

/**
 * Live WhatsApp Web failures from 2026-08-20. Active chat header is
 * "Ummer Mishal"; the sidebar also shows other contacts.
 */
describe("Phase 7.7 — active-chat-header priority", () => {
  const HEADER = ["Ummer Mishal", "Ummer", "Mishal"];
  const SCREEN = ["Ummer Mishal", "Ummer", "Mishal", "Kumar", "Anzal Khan"];

  it("Umar Mishal → Ummer Mishal (full phrase, not just the last name)", () => {
    const res = applyScreenNameBias("Hello Umar Mishal, how are you?", SCREEN, {
      priorityTerms: HEADER,
    });
    expect(res.text).toBe("Hello Ummer Mishal, how are you?");
  });

  it("Umar Misal → Ummer Mishal (both words fixed together)", () => {
    const res = applyScreenNameBias("Hello Umar Misal, how are you?", SCREEN, {
      priorityTerms: HEADER,
    });
    expect(res.text).toBe("Hello Ummer Mishal, how are you?");
  });

  it("Umar → Ummer alone (distance-2 double-letter stretch)", () => {
    const res = applyScreenNameBias("Hello Umar", SCREEN, {
      priorityTerms: HEADER,
    });
    expect(res.text).toBe("Hello Ummer");
  });

  it("Humar → Ummer (silent-H drift, first letter differs)", () => {
    const res = applyScreenNameBias("Hello Humar", SCREEN, {
      priorityTerms: HEADER,
    });
    expect(res.text).toBe("Hello Ummer");
  });

  it("Rayyan → Rayan (collapse duplicated letter)", () => {
    const res = applyScreenNameBias("Hello Rayyan", ["Rayan"], {
      priorityTerms: ["Rayan"],
    });
    expect(res.text).toBe("Hello Rayan");
  });

  it("Ansal → Anzal in an Instagram/WhatsApp DM header", () => {
    const res = applyScreenNameBias("Hey Ansal", ["Anzal"], {
      priorityTerms: ["Anzal"],
    });
    expect(res.text).toBe("Hey Anzal");
  });

  it("NEGATIVE: Kumar Mishra stays put when the open chat is Ummer Mishal", () => {
    const res = applyScreenNameBias("Hello Kumar Mishra", SCREEN, {
      priorityTerms: HEADER,
    });
    expect(res.text).toBe("Hello Kumar Mishra");
    expect(
      res.replacements.every((r) => r.to.toLowerCase() !== "mishal"),
    ).toBe(true);
  });

  it("NEGATIVE: header priority never rewrites common words", () => {
    const res = applyScreenNameBias(
      "I hired you and you're not working, bro",
      ["Morning", "Ummer Mishal"],
      { priorityTerms: ["Morning", "Ummer Mishal"] },
    );
    expect(res.text.toLowerCase()).toContain("working");
    expect(res.text).not.toMatch(/\bMorning\b/);
  });

  it("NEGATIVE: like is not promoted to Liked under header priority", () => {
    const res = applyScreenNameBias(
      "It's like when I want to text someone",
      ["Liked", "Tathir"],
      { priorityTerms: ["Liked"] },
    );
    expect(res.text.toLowerCase()).toContain("like");
    expect(res.text).not.toMatch(/\bLiked\b/);
  });

  it("phoneticKey groups Humar/Umar/Ummer but separates Mishra/Mishal", () => {
    expect(phoneticKey("humar")).toBe(phoneticKey("ummer"));
    expect(phoneticKey("umar")).toBe(phoneticKey("ummer"));
    expect(phoneticKey("mishra")).not.toBe(phoneticKey("mishal"));
    expect(phoneticKey("kumar")).not.toBe(phoneticKey("ummer"));
    expect(phoneticKey("working")).not.toBe(phoneticKey("morning"));
  });

  it("LIVE: Umar Masai → Ummer Mishal (first name anchors identity)", () => {
    // Live 2026-08-20: header was found (headerTerms=[Ummer Mishal, Ummer,
    // Mishal]) but nothing was fixed — phrase distance was ~6 (limit 4), so
    // the sidebar guard fired and then blocked the per-token fix too.
    const res = applyScreenNameBias(
      "Hello, Umar Masai sir, How are you?",
      SCREEN,
      { priorityTerms: HEADER },
    );
    expect(res.text).toContain("Ummer Mishal");
    expect(res.text).not.toMatch(/Umar Masai/);
  });

  it("LIVE: Umar Mishael → Ummer Mishal", () => {
    const res = applyScreenNameBias(
      "Hello, Umar Mishael Sir, How are you?",
      SCREEN,
      { priorityTerms: HEADER },
    );
    expect(res.text).toContain("Ummer Mishal");
  });

  it("LIVE REGRESSION: Kumar Mishra survives even when header detection fails", () => {
    // Live 2026-08-20: `headerTerms=0` on some runs (OCR text varies), so no
    // header guard existed and the legacy token rule produced "Kumar Mishal".
    // A full "First Last" that matched no screen name must never be
    // half-corrected, with or without header context.
    const res = applyScreenNameBias("Hello Kumar Mishra", SCREEN);
    expect(res.text).toBe("Hello Kumar Mishra");
    expect(res.replacements).toEqual([]);
  });

  it("LIVE: Mehreen → Mehrin even when the header name is not in the 40-term list", () => {
    // Live 2026-08-20: headerTerms=[Mehrin, CSI SAFE, ZBRUSH JEWELRY,
    // JEWELRY DESIGN, Professional Jewelry, Jewelry Sculpting]. "Mehrin" is
    // short, so the length-sorted MAX_TERMS cap dropped it from `terms` and it
    // never became a bias target — the contact's own name was ignored.
    const noisyTerms = [
      "Professional Jewelry",
      "Jewelry Sculpting",
      "ZBRUSH JEWELRY",
      "JEWELRY DESIGN",
      "CSI SAFE",
    ];
    const res = applyScreenNameBias("Hello Mehreen, How are you?", noisyTerms, {
      priorityTerms: ["Mehrin"],
    });
    expect(res.text).toBe("Hello Mehrin, How are you?");
  });

  it("first-name anchor still refuses a genuinely different person", () => {
    // Kumar does not match Ummer on any relaxed rule → stays untouched.
    const res = applyScreenNameBias("Hello Kumar Mishra", SCREEN, {
      priorityTerms: HEADER,
    });
    expect(res.text).toBe("Hello Kumar Mishra");
  });

  it("editor / browser titles are NOT treated as chat-header names", () => {
    // Live bug: this title counted as a strong name signal, so the OCR
    // fallback never ran and the real chat header was never seen.
    expect(
      extractTitlePriorityTerms("screen-bias-loop.md - projectRipple - Cursor"),
    ).toEqual([]);
    expect(extractTitlePriorityTerms("Type a message to +971 55 123 4567")).toEqual(
      [],
    );
    // A real contact name still registers.
    expect(extractTitlePriorityTerms("Ummer Mishal - WhatsApp")).toEqual(
      expect.arrayContaining(["Ummer Mishal", "Ummer", "Mishal"]),
    );
  });

  it("finds the open chat name in REAL WhatsApp Web OCR text (repeated name)", () => {
    // Verbatim OCR capture from the live 2026-08-20 session: the header name
    // is never on its own line, it is glued to neighbouring words.
    const ocr = [
      "(64) WhatsApp - Google Chrome",
      "Search or start a new chat",
      "All Bookmarks Ummer Mishal",
      "Ummer Mishal Assalamualikurn Walikumsalaam",
      "Michelle Serina- VaultsPay",
      "Ummer Mishal Thanks Get",
      "PAPER SOLUTION SEMESTER",
    ].join("\n");

    const repeated = extractRepeatedNamePhrases(ocr);
    expect(repeated[0]).toBe("Ummer Mishal");
    // One-off sidebar contacts must not be promoted to header priority.
    expect(repeated).not.toContain("Michelle Serina");

    const priority = [...repeated, ...repeated.flatMap((r) => r.split(/\s+/))];
    const res = applyScreenNameBias(
      "Hello Umar Mishal, how are you?",
      extractCandidateTerms(ocr),
      { priorityTerms: priority },
    );
    expect(res.text).toBe("Hello Ummer Mishal, how are you?");
  });

  /**
   * Generalization: the rules must work for arbitrary names, not just the one
   * contact they were debugged against.
   */
  describe("generalizes to arbitrary contacts", () => {
    const positives: Array<[string, string, string]> = [
      // [on-screen header, what STT heard, expected]
      ["Fatima Sheikh", "Hello Fatma Shaikh", "Hello Fatima Sheikh"],
      ["Rahul Verma", "Hello Rahoul Verma", "Hello Rahul Verma"],
      ["Aisha Khan", "Hello Ayesha Khan", "Hello Aisha Khan"],
      ["Sandeep Nair", "Hello Sandip Nair", "Hello Sandeep Nair"],
      ["Zainab Ali", "Hello Zainub Ali", "Hello Zainab Ali"],
      ["Priya Menon", "Hello Priyaa Menon", "Hello Priya Menon"],
      ["Hassan Raza", "Hello Hasan Raza", "Hello Hassan Raza"],
      ["Nikhil Joshi", "Hello Nikil Joshi", "Hello Nikhil Joshi"],
    ];

    for (const [header, heard, expected] of positives) {
      it(`${heard} → ${expected} (header "${header}")`, () => {
        const priority = [header, ...header.split(/\s+/)];
        const res = applyScreenNameBias(heard, priority, {
          priorityTerms: priority,
        });
        expect(res.text).toBe(expected);
      });
    }

    const negatives: Array<[string, string]> = [
      // Different person entirely — must stay untouched.
      ["Fatima Sheikh", "Hello Ramesh Gupta"],
      ["Rahul Verma", "Hello Sarah Thomas"],
      ["Aisha Khan", "Hello Michael Brown"],
    ];

    for (const [header, heard] of negatives) {
      it(`${heard} stays put when chat header is "${header}"`, () => {
        const priority = [header, ...header.split(/\s+/)];
        const res = applyScreenNameBias(heard, priority, {
          priorityTerms: priority,
        });
        expect(res.text).toBe(heard);
      });
    }

    it("ordinary sentences are never touched by header priority", () => {
      const priority = ["Fatima Sheikh", "Fatima", "Sheikh"];
      for (const sentence of [
        "Please send the report by Friday morning",
        "I am working on the project and it is going well",
        "Can you check the file and let me know",
        "The meeting is at four and we should be ready",
      ]) {
        const res = applyScreenNameBias(sentence, priority, {
          priorityTerms: priority,
        });
        expect(res.text).toBe(sentence);
      }
    });
  });

  it("without priorityTerms the strict legacy rules still apply", () => {
    // No header context → Humar must NOT become Ummer (first-letter gate).
    const res = applyScreenNameBias("Hello Humar", ["Ummer"]);
    expect(res.text).toBe("Hello Humar");
  });
});
