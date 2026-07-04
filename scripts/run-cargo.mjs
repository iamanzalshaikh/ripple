/**
 * Run cargo with a reliable path on Windows (Cursor terminals often miss ~/.cargo/bin).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolveCargo() {
  const fromEnv = process.env.CARGO?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const home = process.env.CARGO_HOME?.trim() || join(homedir(), ".cargo");
  const candidates = [
    join(home, "bin", process.platform === "win32" ? "cargo.exe" : "cargo"),
    "cargo",
  ];

  for (const c of candidates) {
    if (c === "cargo") return c;
    if (existsSync(c)) return c;
  }

  return "cargo";
}

const cargo = resolveCargo();
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/run-cargo.mjs <cargo args...>");
  process.exit(1);
}

const result = spawnSync(cargo, args, {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error(`
[cargo not found]

Rust is not on PATH in this terminal. Fix options:

  1. Close this terminal, open a NEW one, then:
       cd ripple-desktop
       npm run native:build

  2. Or install Rust (once):
       .\\scripts\\install-rust-windows.ps1

  3. Or add cargo for this session only:
       $env:Path += ";$env:USERPROFILE\\.cargo\\bin"
       npm run native:build
`);
  } else {
    console.error(result.error.message);
  }
  process.exit(1);
}

process.exit(result.status ?? 1);
