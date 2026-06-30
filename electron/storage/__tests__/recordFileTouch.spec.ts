import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRippleDb } from "../rippleDb.js";
import {
  clearActivityLog,
  listRecentActivity,
  searchActivityByPhrase,
} from "../activityLog.js";
import {
  clearSemanticIndex,
  getSemanticProfile,
  searchSemanticIndex,
} from "../semanticIndex.js";
import { upsertFileIndexPath } from "../fileIndex.js";
import { setMemory } from "../sessionMemory.js";
import {
  backfillSemanticIndexFromFileIndex,
  recordFileTouch,
  recordWhatsAppSendTouch,
  resolveContactForMemory,
  shouldLogActivity,
} from "../recordFileTouch.js";

describe("recordFileTouch (P8 index on touch)", () => {
  let workDir: string;

  beforeEach(() => {
    initRippleDb();
    clearActivityLog();
    clearSemanticIndex();
    workDir = mkdtempSync(join(tmpdir(), "ripple-touch-"));
  });

  it("indexes semantic profile on open touch", () => {
    const path = join(workDir, "proposal-ahmed.pdf");
    writeFileSync(path, "quarterly proposal for Ahmed");

    recordFileTouch({
      path,
      command: "open Ahmed proposal",
      source: "open",
    });

    const profile = getSemanticProfile(path);
    expect(profile).not.toBeNull();
    expect(profile?.snippet.toLowerCase()).toContain("ahmed");
    expect(searchSemanticIndex("ahmed proposal").some((p) => p.path === path)).toBe(
      true,
    );
  });

  it("logs activity for user-facing touches only", () => {
    const path = join(workDir, "doc.txt");
    writeFileSync(path, "hello");

    recordFileTouch({ path, source: "retriever", logActivity: false });
    expect(listRecentActivity()).toHaveLength(0);

    recordFileTouch({ path, command: "open doc", source: "open" });
    expect(listRecentActivity()).toHaveLength(1);
    expect(listRecentActivity()[0]?.path).toBe(path);
  });

  it("shouldLogActivity defaults by source", () => {
    expect(shouldLogActivity("open")).toBe(true);
    expect(shouldLogActivity("retriever")).toBe(false);
    expect(shouldLogActivity("file_index")).toBe(false);
    expect(shouldLogActivity("clarify")).toBe(true);
  });

  it("resolves pronoun contacts for memory", () => {
    setMemory("last_contact", "Noor");
    expect(resolveContactForMemory("__last_contact__")).toBe("noor");
    expect(resolveContactForMemory(null, "send it to Dr. Fatima")).toBe(
      "dr. fatima",
    );
  });

  it("recordWhatsAppSendTouch links file to contact", () => {
    const path = join(workDir, "noor-resume.pdf");
    writeFileSync(path, "resume for Noor");

    recordWhatsAppSendTouch({
      path,
      contact: "Noor",
      command: "send it to Noor",
    });

    const activity = listRecentActivity();
    expect(activity[0]?.contact).toBe("noor");
    expect(activity[0]?.path).toBe(path);

    const hits = searchActivityByPhrase("PDF I discussed with Noor");
    expect(hits).toContain(path);

    const profiles = searchSemanticIndex("pdf discussed with noor");
    expect(profiles.some((p) => p.path === path)).toBe(true);
  });

  it("backfills semantic index from file_index", () => {
    const path = join(workDir, "goa-itinerary.pdf");
    writeFileSync(path, "Goa trip flights hotel");

    const now = Date.now();
    utimesSync(path, now / 1000, now / 1000);
    upsertFileIndexPath(path);
    clearSemanticIndex();

    const count = backfillSemanticIndexFromFileIndex(100);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(getSemanticProfile(path)).not.toBeNull();
    expect(existsSync(path)).toBe(true);
  });
});
