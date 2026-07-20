import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyPathToDestination } from "../osControlOps.js";
import { resolveParentPath, resolveDestinationDir } from "../fileOperations.js";

/**
 * W0.3 — copy destination truth. Regression for FEATURE_GAPS §3.1 /
 * bug.md: "Copy demo.txt to C:\...\Desktop\Test 2" must land the file
 * INSIDE a created "Test 2" folder, never silently collapse to plain
 * Desktop with a garbage name.
 */
describe("P8.5-P5.6 W0.3 — copy destination creates and uses the named folder", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ripple-w03-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolveParentPath returns an absolute path as-is, even when it doesn't exist yet", () => {
    const dest = join(root, "Test 2");
    expect(existsSync(dest)).toBe(false);
    expect(resolveParentPath(dest)).toBe(dest);
  });

  it("copyPathToDestination creates the missing destination folder and copies inside it", () => {
    const sourceFile = join(root, "demo.txt");
    writeFileSync(sourceFile, "hello world");

    const destFolder = join(root, "Test 2");
    expect(existsSync(destFolder)).toBe(false);

    const target = copyPathToDestination(sourceFile, destFolder);

    expect(target).toBe(join(destFolder, "demo.txt"));
    expect(existsSync(destFolder)).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("hello world");
    // Original must still exist (copy, not move) and Desktop-root must NOT
    // have received a stray copy (the old silent-collapse bug).
    expect(existsSync(sourceFile)).toBe(true);
    expect(existsSync(join(root, "demo.txt.bak"))).toBe(false);
  });

  it("copyPathToDestination works when the destination's parent also doesn't exist yet", () => {
    const sourceFile = join(root, "demo.txt");
    writeFileSync(sourceFile, "nested");

    const destFolder = join(root, "NewParent", "Test 2");
    const target = copyPathToDestination(sourceFile, destFolder);

    expect(target).toBe(join(destFolder, "demo.txt"));
    expect(existsSync(target)).toBe(true);
  });

  it("copies a FOLDER to a missing destination as a direct rename-style copy (wave0 TEST 8)", () => {
    const sourceDir = join(root, "Reports");
    mkdirSync(join(sourceDir, "Q1"), { recursive: true });
    writeFileSync(join(sourceDir, "Q1", "sales.txt"), "q1");
    writeFileSync(join(sourceDir, "report1.txt"), "r1");

    const destFolder = join(root, "Archive");
    expect(existsSync(destFolder)).toBe(false);

    const target = copyPathToDestination(sourceDir, destFolder);

    expect(target).toBe(destFolder);
    expect(existsSync(join(destFolder, "report1.txt"))).toBe(true);
    expect(existsSync(join(destFolder, "Q1", "sales.txt"))).toBe(true);
    // Must NOT nest — Archive\Reports\report1.txt would be wrong.
    expect(existsSync(join(destFolder, "Reports"))).toBe(false);
    expect(existsSync(sourceDir)).toBe(true);
  });

  it("copies a FOLDER into an existing destination directory as a nested child (wave0 TEST 9)", () => {
    const sourceDir = join(root, "Reports");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "report1.txt"), "r1");

    const destFolder = join(root, "Destination");
    mkdirSync(destFolder, { recursive: true });

    const target = copyPathToDestination(sourceDir, destFolder);

    expect(target).toBe(join(destFolder, "Reports"));
    expect(existsSync(join(destFolder, "Reports", "report1.txt"))).toBe(true);
  });

  it("resolveDestinationDir defaults an unrecognized bare name to a sibling of the source, never Desktop", () => {
    const sourceDir = join(root, "Source", "Reports");
    mkdirSync(sourceDir, { recursive: true });

    const destDir = resolveDestinationDir("Archive", sourceDir);
    expect(destDir).toBe(join(root, "Source", "Archive"));
  });
});
