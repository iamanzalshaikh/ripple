/**
 * Runs vitest with RUN_LIVE_TESTS=1 (Windows + Unix).
 * Usage: node scripts/run-vitest-live.mjs [vitest args...]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const path = join(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const args = process.argv.slice(2);
const vitestArgs = args.length > 0 ? args : ["run"];

const result = spawnSync("npx", ["vitest", ...vitestArgs], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, RUN_LIVE_TESTS: "1" },
});

process.exit(result.status ?? 1);
