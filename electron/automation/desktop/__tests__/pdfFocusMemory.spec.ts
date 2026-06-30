import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  extractPdfNameFromWindowTitle,
  extractPdfPathFromUrl,
  resolveLastPdfPath,
} from "../pdfFocusMemory.js";
import { setMemory, clearMemory } from "../../../storage/sessionMemory.js";

describe("pdfFocusMemory", () => {
  it("extracts PDF name from Edge tab title", () => {
    expect(
      extractPdfNameFromWindowTitle(
        "phase2developmentfinal (1).pdf and 1 more page - Personal - ",
      ),
    ).toBe("phase2developmentfinal (1).pdf");
  });

  it("extracts PDF name from simple title", () => {
    expect(extractPdfNameFromWindowTitle("RipplePhase4.pdf - Personal")).toBe(
      "RipplePhase4.pdf",
    );
  });

  it("parses file URL when path exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-pdf-url-"));
    const file = join(dir, "report.pdf");
    writeFileSync(file, "%PDF");

    const path = extractPdfPathFromUrl(
      `file:///${file.replace(/\\/g, "/")}`,
    );
    expect(path).toBe(file);
  });

  it("prefers recently viewed PDF over stale last_pdf", async () => {
    clearMemory("last_pdf");
    clearMemory("last_viewed_pdf");
    clearMemory("last_viewed_pdf_at");
    clearMemory("last_viewed_pdf_title");

    const dir = mkdtempSync(join(tmpdir(), "ripple-pdf-recall-"));
    const viewed = join(dir, "phase2developmentfinal (1).pdf");
    const stale = join(dir, "RipplePhase4.pdf");
    writeFileSync(viewed, "%PDF-1.4");
    writeFileSync(stale, "%PDF-1.4");

    setMemory("last_pdf", stale);
    setMemory("last_viewed_pdf", viewed);
    setMemory("last_viewed_pdf_at", String(Date.now()));
    setMemory("last_viewed_pdf_title", "phase2developmentfinal (1).pdf");

    const resolved = await resolveLastPdfPath({
      hwnd: 0,
      processName: "msedge",
      windowTitle: "phase2developmentfinal (1).pdf and 1 more page - Personal - ",
      capturedAt: Date.now(),
      isGmail: false,
      isWhatsApp: false,
      isSlack: false,
      isNotion: false,
      isYouTube: false,
      isLinkedIn: false,
      isInstagram: false,
      isBrowser: true,
    });

    expect(resolved).toBeTruthy();
    expect(basename(resolved!)).toBe("phase2developmentfinal (1).pdf");
    expect(resolved).not.toBe(stale);
  });
});
