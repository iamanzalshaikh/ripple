import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export type Test56ExpectKind =
  | "execute"
  | "defer"
  | "clarify"
  | "blocked"
  | "partial";

export type Test56Case = {
  id: string;
  section: string;
  index: number;
  command: string;
  kind?: Test56ExpectKind;
  altKinds?: Test56ExpectKind[];
  tools?: string[];
  altToolSets?: string[][];
  toolPrefixes?: string[];
  forbid?: string[];
  minSteps?: number;
};

const CASES_PATH = join(process.cwd(), "scripts", "test56-matrix-cases.json");

export function ensureTest56CasesExported(): void {
  if (!existsSync(CASES_PATH)) {
    execSync("node scripts/parse-test56-doc.mjs", {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  }
}

export function loadTest56Matrix(): Test56Case[] {
  ensureTest56CasesExported();
  return JSON.parse(readFileSync(CASES_PATH, "utf8")) as Test56Case[];
}
