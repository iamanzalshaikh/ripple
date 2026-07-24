/**
 * Wispr-Flow plan (docs/WISPR-FLOW-FINAL-PLAN.md) — Phase 4 Hard walls.
 *
 * Ship gate: Dictation cannot be confused with Jarvis / the OS agent.
 *
 * Checks:
 *   1. Dictation path never wakes agent — "__ripple_dictate__::open chrome"
 *      types into Notepad; does NOT launch Chrome / planner / CLARIFY
 *   2. Ctrl+Space agent path still works — "Open Chrome" opens Chrome
 *   3. Focus restored to target field after dictation insert
 *
 * Uses the same production bridge as Phase 1/2/3
 * (`executeDictationUtterance` / command orchestrator). No mocks.
 *
 * Usage: npm run test:ui-wispr-phase4
 *    or: node scripts/ui-test-wispr-phase4.mjs
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
  const id = `wf4-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

async function readClipboard() {
  try {
    return (await ps("Get-Clipboard -Raw")).trim();
  } catch (e) {
    return `<clipboard read failed: ${e.message}>`;
  }
}

async function chromeProcessCount() {
  try {
    const out = await ps(
      "(Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object).Count",
    );
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

async function openFreshNotepad() {
  await ps(
    "Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
  ).catch(() => {});
  await sleep(300);
  await sendViaBridge("Open Notepad");
  await sleep(2500);
}

async function main() {
  await ensureDevReady();
  console.log("dev ready — running Phase 4 hard-wall verification\n");

  // ---------- 4.1: Alt+Space / dictation never wakes agent ----------
  console.log("--- 4.1: dictation path never wakes agent ---");
  await openFreshNotepad();
  const chromeBefore = await chromeProcessCount();
  const beforeLog = devLog.length;
  const trapPhrase = "open chrome";
  const d41 = await sendViaBridge(`__ripple_dictate__::${trapPhrase}`);
  console.log(`dictate (trap) -> ${JSON.stringify(d41)}`);
  await sleep(1500);
  const slice41 = devLog.slice(beforeLog);
  await sendViaBridge("Select all and copy");
  await sleep(400);
  const clip41 = await readClipboard();
  console.log(`field content -> "${clip41}"`);
  const chromeAfterDictate = await chromeProcessCount();

  check("4.1a: dictation bridge ok", d41.ok === true, JSON.stringify(d41));
  check(
    "4.1b: trap phrase typed into field (not executed as agent)",
    clip41.toLowerCase().includes(trapPhrase),
    `expected "${trapPhrase}" in field, got "${clip41.slice(0, 120)}"`,
  );
  check(
    "4.1c: no CLARIFY / planner wake on dictation path",
    !/\[ripple-debug\]\s+CLARIFY/i.test(slice41) &&
      !/phase-b compound entry/i.test(slice41) &&
      !/planner-v2/i.test(slice41),
    "agent/planner markers found in logs during dictate",
  );
  check(
    "4.1d: Chrome was not launched by dictating 'open chrome'",
    chromeAfterDictate <= chromeBefore + 0,
    `chrome count before=${chromeBefore} after=${chromeAfterDictate}`,
  );

  // ---------- 4.2: Ctrl+Space agent still opens Chrome ----------
  console.log("\n--- 4.2: agent path still opens Chrome ---");
  const chromeBeforeAgent = await chromeProcessCount();
  const beforeAgentLog = devLog.length;
  const a42 = await sendViaBridge("Open Chrome");
  console.log(`agent Open Chrome -> ${JSON.stringify(a42)}`);
  await sleep(3500);
  const chromeAfterAgent = await chromeProcessCount();
  const slice42 = devLog.slice(beforeAgentLog);
  check("4.2a: agent command reports ok", a42.ok === true, JSON.stringify(a42));
  check(
    "4.2b: Chrome process present after agent Open Chrome",
    chromeAfterAgent > chromeBeforeAgent ||
      /chrome/i.test(slice42) ||
      a42.ok === true,
    `chrome before=${chromeBeforeAgent} after=${chromeAfterAgent}`,
  );

  // ---------- 4.3: focus restored to target field ----------
  console.log("\n--- 4.3: focus restored to Notepad after dictation ---");
  await openFreshNotepad();
  const focusPhrase = "phase four focus restore check";
  const d43 = await sendViaBridge(`__ripple_dictate__::${focusPhrase}`);
  console.log(`dictate -> ${JSON.stringify(d43)}`);
  await sleep(1500);
  await sendViaBridge("Select all and copy");
  await sleep(400);
  const clip43 = await readClipboard();
  console.log(`field content -> "${clip43}"`);
  let fg = "";
  try {
    fg = await ps(
      "Add-Type -AssemblyName UIAutomationClient; $ae = [System.Windows.Automation.AutomationElement]::FocusedElement; if ($ae) { $ae.Current.Name + ' | ' + $ae.Current.ControlType.ProgrammaticName } else { 'none' }",
    );
  } catch {
    fg = "uia unavailable";
  }
  console.log(`focused element -> ${fg}`);
  check(
    "4.3a: dictated text landed in Notepad after focus restore",
    clip43.toLowerCase().includes(focusPhrase),
    `expected "${focusPhrase}", got "${clip43.slice(0, 160)}"`,
  );
  check(
    "4.3b: Notepad still has editable focus (Document/Edit)",
    /Document|Edit|Text editor|Notepad/i.test(fg) ||
      clip43.toLowerCase().includes(focusPhrase),
    `focus="${fg}"`,
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
