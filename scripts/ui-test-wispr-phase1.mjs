/**
 * Wispr-Flow plan (docs/WISPR-FLOW-FINAL-PLAN.md) — Phase 1 insert matrix.
 *
 * Drives the REAL dictation pipeline (correction → insert ladder) against the
 * real running app via the file bridge (electron/osTestBridge.ts), using the
 * `__ripple_dictate__::` prefix wired into main/index.ts's bridge callback —
 * this calls the exact same executeDictationUtterance() that production STT
 * calls, just skipping the microphone/Whisper round-trip.
 *
 * Verification is via the real OS: after insert, the script sends a normal
 * "select all and copy" OS command through the same bridge (already a
 * production-proven native path), then reads the real Windows clipboard and
 * compares it to what was dictated. No mocks.
 *
 * Only covers Notepad + Cursor (the two "not proven" apps in the plan).
 * WhatsApp/Gmail need a real logged-in session and are intentionally left
 * for manual re-verification — auto-driving those risks sending real
 * messages/emails to real accounts.
 *
 * Usage: node scripts/ui-test-wispr-phase1.mjs
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
let devLog = "";

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
  const id = `wf1-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  const proc = spawn("npx", ["electron-vite", "dev"], {
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
  proc.stdout.on("data", (d) => {
    devLog += d.toString();
  });
  proc.stderr.on("data", (d) => {
    devLog += d.toString();
  });
  return proc;
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

function lastInsertStrategyLine() {
  const lines = devLog.split(/\r?\n/).filter((l) => l.includes("[ripple-insert]"));
  return lines.length ? lines[lines.length - 1] : null;
}

async function testInsertInApp(appLabel, openFn, expectedText) {
  console.log(`\n--- ${appLabel} ---`);
  const opened = await openFn();
  console.log(`open -> ${JSON.stringify(opened)}`);
  await sleep(3500);

  const beforeLogLen = devLog.length;
  const dictated = await sendViaBridge(`__ripple_dictate__::${expectedText}`);
  console.log(`dictate -> ${JSON.stringify(dictated)}`);
  await sleep(1500);

  check(`${appLabel}: dictation pipeline reports ok`, dictated.ok === true, JSON.stringify(dictated));

  const newLog = devLog.slice(beforeLogLen);
  const strategyMatch = newLog.match(/\[ripple-insert\] strategy=(\S+) status=(\w+)/);
  if (strategyMatch) {
    console.log(`insert log -> strategy=${strategyMatch[1]} status=${strategyMatch[2]}`);
  } else {
    console.log("insert log -> no [ripple-insert] line found for this insert");
  }
  check(
    `${appLabel}: insert log shows a strategy result`,
    Boolean(strategyMatch),
    "no [ripple-insert] strategy=... line in dev output",
  );

  // Verify via real OS: select all + copy, then read the real clipboard.
  const copyRes = await sendViaBridge("Select all and copy");
  console.log(`copy -> ${JSON.stringify(copyRes)}`);
  await sleep(400);
  let clip = "";
  try {
    clip = await ps("Get-Clipboard -Raw");
  } catch (e) {
    clip = `<clipboard read failed: ${e.message}>`;
  }
  const clipTrim = clip.trim();
  const expectedTrim = expectedText.trim();
  check(
    `${appLabel}: focused field actually contains dictated text`,
    clipTrim.toLowerCase().includes(expectedTrim.toLowerCase()),
    `expected to contain "${expectedTrim}", clipboard was "${clipTrim.slice(0, 200)}"`,
  );
}

async function main() {
  await ps(
    "Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
  ).catch(() => {});

  await ensureDevReady();
  console.log("dev ready — running Phase 1 insert matrix (Notepad, Cursor)\n");

  const scratchFile = join(RIPPLE_DIR, "wispr-phase1-scratch.txt");
  writeFileSync(scratchFile, "", "utf8");

  await testInsertInApp(
    "Notepad",
    () => sendViaBridge("Open Notepad"),
    "hello world from ripple wispr flow test",
  );
  await testInsertInApp(
    "Cursor",
    // Open directly into an editable buffer (not Cursor's cold-start Welcome
    // tab, which has no text control at all) — this is test scenario setup,
    // not the feature under test, so it goes straight through the OS rather
    // than via a Ripple voice-command phrase.
    () => ps(`Start-Process cursor -ArgumentList '"${scratchFile}"'; Start-Sleep -Milliseconds 500; "opened"`),
    "hello world from ripple wispr flow test",
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
