import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestCrossAppReference } from "../crossAppIngest.js";
import { searchSemanticRefs } from "../semanticEmbeddings.js";
import { searchCrossAppAttachmentPaths } from "../activityLog.js";
import { getRippleDb } from "../rippleDb.js";

describe("crossAppIngest attachments", () => {
  it("stores per-attachment semantic refs", () => {
    getRippleDb();
    ingestCrossAppReference({
      appId: "gmail",
      summary: "From: Ahmed — Email: Proposal — Attachments: ahmed-proposal.pdf",
      contact: "ahmed",
      externalUrl: "https://mail.google.com/mail/u/0/#inbox/abc123",
      attachments: ["ahmed-proposal.pdf"],
    });

    const refs = searchSemanticRefs("pdf from ahmed", 10);
    const hit = refs.find((r) =>
      r.summary.toLowerCase().includes("attachment: ahmed-proposal.pdf"),
    );
    expect(hit).toBeTruthy();
    expect(hit?.appId).toBe("gmail");
  });

  it("indexes downloaded attachment path for voice recall", () => {
    getRippleDb();
    const dir = join(tmpdir(), `ripple-p8c-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "ahmed-invoice.pdf");
    writeFileSync(path, "%PDF-1.4 test");

    ingestCrossAppReference({
      appId: "gmail",
      summary: "From: Ahmed — Invoice Q4",
      contact: "ahmed",
      path,
      attachments: ["ahmed-invoice.pdf"],
      command: "Gmail attachment: ahmed-invoice.pdf",
    });

    expect(existsSync(path)).toBe(true);
    const hits = searchCrossAppAttachmentPaths("pdf ahmed", {
      extension: "pdf",
      contact: "ahmed",
    });
    expect(hits.some((p) => p.toLowerCase().endsWith("ahmed-invoice.pdf"))).toBe(
      true,
    );
  });
});
