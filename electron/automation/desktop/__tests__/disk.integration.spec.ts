import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "ripple-phase4-disk-"));

vi.mock("../../../storage/fileIndex.js", () => ({
  searchIndexByName: () => [],
  getFileIndexCount: () => 0,
  rebuildFileIndex: () => {},
  upsertFileIndexPath: () => {},
}));

vi.mock("../openFolder.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openFolder.js")>();
  return {
    ...actual,
    resolveFolderPath: () => TEST_ROOT,
  };
});

beforeAll(() => {
  writeFileSync(join(TEST_ROOT, "phase4-test-resume.pdf"), "%PDF-1.4 ripple test");
  writeFileSync(join(TEST_ROOT, "Invoice_March.pdf"), "invoice");
  mkdirSync(join(TEST_ROOT, "RippleNotes"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "RippleNotes", "ideas.txt"), "notes");
});

afterAll(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("Phase 4.2/4.5 — disk file search (integration)", () => {
  it("finds exact file on disk when index is empty", async () => {
    const { searchItemsByNameAsync } = await import("../searchFiles.js");
    const hits = await searchItemsByNameAsync("phase4-test-resume.pdf");
    expect(hits.some((p) => p.endsWith("phase4-test-resume.pdf"))).toBe(true);
  });

  it("finds partial token match (resume)", async () => {
    const { searchItemsByNameAsync } = await import("../searchFiles.js");
    const hits = await searchItemsByNameAsync("resume");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((p) => /resume/i.test(p))).toBe(true);
  });

  it("finds nested folder file", async () => {
    const { searchItemsByNameAsync } = await import("../searchFiles.js");
    const hits = await searchItemsByNameAsync("ideas.txt");
    expect(hits.some((p) => p.includes("RippleNotes"))).toBe(true);
  });

  it("returns empty for nonsense name", async () => {
    const { searchItemsByNameAsync } = await import("../searchFiles.js");
    const hits = await searchItemsByNameAsync("zzz_nonexistent_ripple_xyz");
    expect(hits.length).toBe(0);
  });
});

describe("Phase 4.2 — open file on disk (integration)", () => {
  it("openFile succeeds when path exists", async () => {
    const { openFile } = await import("../openFolder.js");
    const path = join(TEST_ROOT, "phase4-test-resume.pdf");
    const result = await openFile(path);
    expect(result).toMatch(/Opened file/i);
  });

  it("openFile throws when missing", async () => {
    const { openFile } = await import("../openFolder.js");
    await expect(openFile(join(TEST_ROOT, "nope.pdf"))).rejects.toThrow(
      /not found/i,
    );
  });

  it("openFolder succeeds for test root", async () => {
    const { openFolder } = await import("../openFolder.js");
    const result = await openFolder(TEST_ROOT);
    expect(result).toMatch(/Opened folder/i);
  });
});

describe("Phase 4.5 — Windows shell search (live, win32 only)", () => {
  it.skipIf(process.platform !== "win32")(
    "finds file created in real Downloads folder",
    async () => {
      const downloads = join(homedir(), "Downloads");
      const token = `ripple-e2e-${Date.now()}`;
      const fname = `${token}.txt`;
      const fpath = join(downloads, fname);

      writeFileSync(fpath, "ripple phase4 e2e");
      try {
        const { searchWindowsShell } = await import("../windowsSearch.js");
        const hits = await searchWindowsShell(token);
        expect(hits.some((p) => p.toLowerCase().includes(token.toLowerCase()))).toBe(
          true,
        );
      } finally {
        if (existsSync(fpath)) unlinkSync(fpath);
      }
    },
    25_000,
  );
});
