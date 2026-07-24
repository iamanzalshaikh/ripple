/**
 * Targeted live check: does Ripple resolve a spoken item by NAME ALONE
 * (no drive letter, no absolute path) once that item exists on disk and has
 * been touched/created by Ripple before? This is what a real user says —
 * the wave0 suite's absolute paths exist only for deterministic test setup.
 *
 * Sandbox: C:\Ripple-Test\W0\Source\Reports\Q1 (created directly via fs,
 * then indexed the same way createFolder() would index it).
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RIPPLE_DIR = join(homedir(), "AppData", "Roaming", "ripple-desktop");
const IN_FILE = join(RIPPLE_DIR, "os-test-in.json");
const OUT_FILE = join(RIPPLE_DIR, "os-test-out.json");
const BRIDGE_PING = "__ripple_os_bridge_ping__";

const W0_ROOT = "C:\\Ripple-Test";
const Q1 = join(W0_ROOT, "W0", "Source", "Reports", "Q1");

let devProc = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendViaBridge(command, timeoutMs = 60_000) {
  if (!existsSync(RIPPLE_DIR)) mkdirSync(RIPPLE_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) unlinkSync(OUT_FILE);
  const id = `bn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  writeFileSync(IN_FILE, JSON.stringify({ id, command }), "utf8");

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(OUT_FILE)) {
      const out = JSON.parse(readFileSync(OUT_FILE, "utf8"));
      if (out.id === id) return out;
    }
    await sleep(300);
  }
  throw new Error(`bridge timeout waiting for: ${command}`);
}

function spawnDev() {
  return spawn("npx", ["electron-vite", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      RIPPLE_P85_PHASE_B: "1",
      RIPPLE_P85_PLANNER_V2: "all",
      RIPPLE_OS_TEST: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
}

async function ensureDevReady() {
  devProc = spawnDev();
  let ready = false;
  const started = Date.now();
  while (Date.now() - started < 45_000 && !ready) {
    try {
      const r = await sendViaBridge(BRIDGE_PING, 3000);
      if (r) ready = true;
    } catch {
      await sleep(1000);
    }
  }
  if (!ready) throw new Error("dev never came up");
}

function cleanupDev() {
  if (!devProc || devProc.killed) return;
  const pid = devProc.pid;
  if (process.platform === "win32" && pid) {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      shell: true,
    });
  } else {
    devProc.kill("SIGTERM");
  }
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function main() {
  rmSync(W0_ROOT, { recursive: true, force: true });
  console.log(`sandbox reset: ${W0_ROOT}`);

  await ensureDevReady();
  console.log("dev ready, building tree via real voice commands (T1-T5 style)...\n");

  // Ripple only "knows" about a path by NAME once it has actually created or
  // touched it (createFolder() indexes every path it creates). This mirrors
  // a real session: the user says the full path a few times while setting
  // things up, then refers to items by name alone from then on.
  const w0Root = join(W0_ROOT, "W0");
  const source = join(w0Root, "Source");
  const reports = join(source, "Reports");
  for (const cmd of [
    `Create a folder called Ripple-Test on C drive`,
    `Create a folder called W0 inside ${W0_ROOT}`,
    `Create a folder called Source inside ${w0Root}`,
    `Create a folder called Reports inside ${source}`,
    `Create a folder called Q1 inside ${reports}`,
  ]) {
    const r = await sendViaBridge(cmd);
    console.log(`setup: ${cmd} ->`, JSON.stringify(r));
  }

  console.log("\nrunning bare-name checks...\n");

  const r1 = await sendViaBridge("Copy the folder Q1 to a new folder called BareCopy");
  console.log("bare copy result ->", JSON.stringify(r1));
  const expected1 = join(W0_ROOT, "W0", "Source", "Reports", "BareCopy");
  check(
    "bare-name copy_folder resolves 'Q1' without any path",
    r1.ok === true && existsSync(expected1),
    `expected dir at ${expected1}, ok=${r1.ok}, error=${r1.error}`,
  );

  const r2 = await sendViaBridge("Find Reports folder");
  console.log("bare find result ->", JSON.stringify(r2));
  check("bare-name search finds 'Reports'", r2.ok === true, r2.error);

  const r3 = await sendViaBridge(
    "Copy the folder ThisFolderDoesNotExistAnywhere123 to a new folder called ShouldFail",
  );
  console.log("bare unknown-name result ->", JSON.stringify(r3));
  check(
    "unknown bare name fails cleanly (no silent Desktop fallback)",
    r3.ok === false,
    JSON.stringify(r3),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  cleanupDev();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  cleanupDev();
  process.exit(1);
});
