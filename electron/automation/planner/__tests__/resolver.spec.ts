import { describe, expect, it } from "vitest";
import { initRippleDb } from "../../../storage/rippleDb.js";
import { recordTrustSignal } from "../../../storage/actionTrust.js";
import { resolveCandidates } from "../resolver.js";
import type { Candidate } from "../types.js";

const sample = (n: number): Candidate[] =>
  Array.from({ length: n }, (_, i) => ({
    path: `C:\\test\\file${i}.pdf`,
    label: `file${i}.pdf`,
    score: 0.9 - i * 0.1,
    source: "index" as const,
  }));

describe("resolver", () => {
  it("rephrases on low confidence", () => {
    const r = resolveCandidates("my resume", [], 0.4);
    expect(r.kind).toBe("rephrase");
  });

  it("executes single high-confidence candidate", () => {
    const r = resolveCandidates("resume", sample(1), 0.95);
    expect(r.kind).toBe("execute");
    if (r.kind === "execute") {
      expect(r.candidate.label).toBe("file0.pdf");
    }
  });

  it("clarifies on multiple candidates", () => {
    const r = resolveCandidates("invoice", sample(3), 0.92);
    expect(r.kind).toBe("clarify");
    if (r.kind === "clarify") {
      expect(r.candidates).toHaveLength(3);
    }
  });

  it("clarifies when zero candidates at high confidence", () => {
    const r = resolveCandidates("missing", [], 0.95);
    expect(r.kind).toBe("clarify");
  });

  it("auto-executes top match when trust is high", () => {
    initRippleDb();
    for (let i = 0; i < 10; i++) {
      recordTrustSignal("my resume", "success");
    }
    const r = resolveCandidates("my resume", sample(3), 0.95);
    expect(r.kind).toBe("execute");
    if (r.kind === "execute") {
      expect(r.candidate.label).toBe("file0.pdf");
    }
  });
});
