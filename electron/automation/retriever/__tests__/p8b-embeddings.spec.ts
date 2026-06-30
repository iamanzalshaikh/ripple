import { describe, expect, it, beforeEach } from "vitest";
import { embedText, cosineSimilarity } from "../localEmbedding.js";
import {
  clearSemanticEmbeddings,
  searchPathEmbeddings,
  searchSemanticRefs,
  upsertPathEmbedding,
  upsertSemanticRef,
} from "../../../storage/semanticEmbeddings.js";
import { initRippleDb } from "../../../storage/rippleDb.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("P8b+ local embeddings", () => {
  beforeEach(() => {
    initRippleDb();
    clearSemanticEmbeddings();
  });

  it("similar phrases score higher than unrelated", () => {
    const a = embedText("quarterly proposal discussed with ahmed");
    const b = embedText("ahmed budget proposal pdf");
    const c = embedText("random cooking recipe pasta");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  it("searchPathEmbeddings finds related path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-emb-"));
    const path = join(dir, "contract-ahmed.pdf");
    writeFileSync(path, "contract");

    upsertPathEmbedding(
      path,
      "contract draft quarterly proposal discussed with Ahmed",
    );

    const hits = searchPathEmbeddings("PDF I discussed with Ahmed", 5);
    expect(hits[0]?.path).toBe(path);
    expect(hits[0]?.score).toBeGreaterThan(0.3);
  });

  it("searchSemanticRefs finds slack summary without file path", () => {
    upsertSemanticRef({
      appId: "slack",
      contact: "sarah",
      summary: "Sarah shared contract draft for review",
    });

    const refs = searchSemanticRefs("that thing Sarah sent", 5);
    expect(refs.some((r) => r.contact === "sarah")).toBe(true);
  });
});
