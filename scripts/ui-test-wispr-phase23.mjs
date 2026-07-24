/**
 * Wispr-Flow plan (docs/WISPR-FLOW-FINAL-PLAN.md) — Phase 2 (Corrections live)
 * and Phase 3 (Personal name) verification.
 *
 * Drives the real dictation pipeline via the `__ripple_dictate__::` /
 * `__ripple_dictate_continue__::` bridge prefixes (electron/main/index.ts),
 * which call the exact same executeDictationUtterance() production STT calls
 * — no microphone needed, but everything downstream (correction engine,
 * insert ladder, personal-correction lookup) is the real code.
 *
 * Phase 2 checks (plan doc section 5, Phase 2):
 *   1. "no no" course-correction
 *   2. No intermediate scraps typed (two separate push-to-talk presses for
 *      one thought must not leave both the pre- and post-correction text in
 *      the field)
 *   3. Ambiguous -> fail-open literal
 *
 * Phase 3 checks:
 *   1. Learn nor -> Noor
 *   2. "hi nor" -> "hi Noor"
 *
 * Usage: node scripts/ui-test-wispr-phase23.mjs
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
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

let devProc = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ps(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-Command", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || out || `exit ${code}`));
      else resolve(out.trim());
    });
  });
}

async function sendViaBridge(command, timeoutMs = 60_000) {
  if (!existsSync(RIPPLE_DIR)) mkdirSync(RIPPLE_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) unlinkSync(OUT_FILE);
  const id = `wf23-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

async function readClipboard() {
  try {
    return (await ps("Get-Clipboard -Raw")).trim();
  } catch (e) {
    return `<clipboard read failed: ${e.message}>`;
  }
}

async function copyNotepadContents() {
  await sendViaBridge("Select all and copy");
  await sleep(400);
  return readClipboard();
}

async function openFreshNotepad() {
  await ps(
    "Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
  ).catch(() => {});
  await sleep(300);
  const opened = await sendViaBridge("Open Notepad");
  await sleep(2500);
  return opened;
}

async function main() {
  await ensureDevReady();
  console.log("dev ready — running Phase 2 + Phase 3 verification\n");

  // ---------------- Phase 2.1: "no no" course-correction ----------------
  console.log("--- Phase 2.1: no-no course-correction ---");
  await openFreshNotepad();
  const p21 = await sendViaBridge(
    "__ripple_dictate__::meet at 2, no wait, 3",
  );
  console.log(`dictate -> ${JSON.stringify(p21)}`);
  await sleep(1000);
  const p21Clip = await copyNotepadContents();
  console.log(`field content -> "${p21Clip}"`);
  check(
    "2.1: final text contains the corrected value (3), not both",
    /\b3\b/.test(p21Clip) && !/\b2\b.*\b3\b/.test(p21Clip.replace(/[.,]/g, "")),
    `expected a clean correction to "3", got "${p21Clip}"`,
  );

  // ---------- Phase 2.2: no intermediate scraps across two hotkey presses ----------
  console.log("\n--- Phase 2.2: no intermediate scraps (two press-cycles, one thought) ---");
  await openFreshNotepad();
  const p22a = await sendViaBridge("__ripple_dictate__::meet at 2");
  console.log(`press 1 -> ${JSON.stringify(p22a)}`);
  await sleep(800);
  const afterPress1 = await copyNotepadContents();
  console.log(`field after press 1 -> "${afterPress1}"`);
  const p22b = await sendViaBridge("__ripple_dictate_continue__::no wait 3");
  console.log(`press 2 (continue session) -> ${JSON.stringify(p22b)}`);
  await sleep(800);
  const afterPress2 = await copyNotepadContents();
  console.log(`field after press 2 -> "${afterPress2}"`);
  check(
    "2.2: field doesn't contain both the pre-correction and post-correction text",
    !(/\b2\b/.test(afterPress2) && /\b3\b/.test(afterPress2)),
    `expected only the corrected value to remain, got "${afterPress2}"`,
  );

  // ---------------- Phase 2.3: ambiguous -> fail-open literal ----------------
  console.log("\n--- Phase 2.3: ambiguous utterance fails open to literal text ---");
  await openFreshNotepad();
  const literalText = "the quarterly report is ready for review";
  const p23 = await sendViaBridge(`__ripple_dictate__::${literalText}`);
  console.log(`dictate -> ${JSON.stringify(p23)}`);
  await sleep(1000);
  const p23Clip = await copyNotepadContents();
  console.log(`field content -> "${p23Clip}"`);
  check(
    "2.3: plain unambiguous text is typed literally",
    p23Clip.toLowerCase().includes(literalText.toLowerCase()),
    `expected literal text to appear, got "${p23Clip}"`,
  );

  // ---------------- Phase 3.1 + 3.2: personal name learning ----------------
  console.log("\n--- Phase 3.1/3.2: learn nor -> Noor, then dictate 'hi nor' ---");
  const learnRes = await sendViaBridge("learn that nor means Noor");
  console.log(`learn -> ${JSON.stringify(learnRes)}`);
  check("3.1: correction learned (tool call ok)", learnRes.ok === true, JSON.stringify(learnRes));

  await openFreshNotepad();
  const p32 = await sendViaBridge("__ripple_dictate__::hi nor");
  console.log(`dictate -> ${JSON.stringify(p32)}`);
  await sleep(1000);
  const p32Clip = await copyNotepadContents();
  console.log(`field content -> "${p32Clip}"`);
  check(
    "3.2: 'hi nor' becomes 'hi Noor'",
    /\bNoor\b/.test(p32Clip),
    `expected "Noor" in output, got "${p32Clip}"`,
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
