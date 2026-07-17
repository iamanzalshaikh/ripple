import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectPackageTestScript,
  detectTestCommand,
} from "../runTests.js";

describe("runTests package.json detection", () => {
  it("returns null when package.json has no test script", () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-test-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { start: "node index.js" } }));
      expect(detectPackageTestScript(dir)).toBeNull();
      expect(detectTestCommand(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects npm test script", () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-test-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
      );
      expect(detectPackageTestScript(dir)).toBe("test");
      expect(detectTestCommand(dir)).toEqual({ runner: "npm", command: "npm run test" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
