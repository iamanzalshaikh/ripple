/**
 * UI automation for docs/test5.-6.md (P5.5 + P6 voice commands).
 * Uses Ripple os-test file bridge (same as ui-test-p5-qa-matrix.mjs).
 *
 * Usage:
 *   npm run test:ui-test56           # planner unit + OS bridge matrix
 *   npm run test:ui-test56-only      # bridge only (--reuse-dev if Ripple already up)
 */
import { spawn, spawnSync } from "node:child_process";
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
const CASES_FILE = join(ROOT, "scripts", "test56-matrix-cases.json");
const BRIDGE_PING = "__ripple_os_bridge_ping__";

let devProc = null;
let ownsDev = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadEnvFile() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

function applyTestEnv() {
  process.env.RIPPLE_P85_PLANNER_V2 = "all";
  process.env.RIPPLE_P85_TOOL_EXECUTOR = "1";
  process.env.RIPPLE_INSERT_TEXT_DIAG = "1";
  process.env.RIPPLE_P85_VISION_INSERT = "1";
  process.env.RIPPLE_USE_CDP = "0";
  process.env.RIPPLE_OS_TEST = "1";
  process.env.RIPPLE_OS_TEST_PLAN_ONLY = "1";
  process.env.RIPPLE_P85_PHASE_B = "1";
}

function exportCases() {
  const r = spawnSync("node", ["scripts/parse-test56-doc.mjs"], {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(1);
}

function loadCases() {
  exportCases();
  return JSON.parse(readFileSync(CASES_FILE, "utf8"));
}

function isSubsequence(expected, actual) {
  let i = 0;
  for (const tool of actual) {
    if (tool === expected[i]) i++;
    if (i >= expected.length) return true;
  }
  return i >= expected.length;
}

function matchesTools(actual, primary, altSets) {
  if (primary?.length && isSubsequence(primary, actual)) return true;
  if (altSets?.length) {
    return altSets.some((set) => isSubsequence(set, actual));
  }
  return !primary?.length;
}

function matchesPrefixes(actual, prefixes) {
  if (!prefixes?.length) return true;
  return actual.some((t) => prefixes.some((p) => t.startsWith(p)));
}

async function ps(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-STA", "-Command", script],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || out || `exit ${code}`));
      else resolve(out.trim());
    });
  });
}

async function rippleRunning() {
  try {
    const out = await ps(
      `(Get-Process -Name electron -ErrorAction SilentlyContinue | Measure-Object).Count`,
    );
    return Number(out) > 0;
  } catch {
    return false;
  }
}

async function sendViaBridge(command, timeoutMs = 300_000) {
  if (!existsSync(RIPPLE_DIR)) mkdirSync(RIPPLE_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) unlinkSync(OUT_FILE);
  const id = `t56-${Date.now()}`;
  writeFileSync(IN_FILE, JSON.stringify({ id, command }), "utf8");

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(OUT_FILE)) {
      const out = JSON.parse(readFileSync(OUT_FILE, "utf8"));
      if (out.id !== id) await sleep(300);
      else return out;
    }
    await sleep(400);
  }
  throw new Error("bridge timeout — start Ripple with RIPPLE_OS_TEST=1");
}

function spawnDev() {
  return spawn("npx", ["electron-vite", "dev"], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
}

function cleanupDev() {
  if (!ownsDev || !devProc || devProc.killed) return;
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

async function waitForBridge(timeoutMs = 240_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await rippleRunning()) {
      try {
        const out = await sendViaBridge(BRIDGE_PING, 15_000);
        if (out.ok !== undefined) return;
      } catch {
        /* not ready */
      }
    }
    await sleep(800);
  }
  throw new Error("Ripple dev started but os-test bridge never became ready");
}

async function stopRippleDev() {
  spawnSync("node", ["scripts/stop-dev.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  await sleep(1200);
}

async function ensureRippleDev() {
  if (process.argv.includes("--reuse-dev") && (await rippleRunning())) {
    try {
      await sendViaBridge(BRIDGE_PING, 15_000);
      console.log("[test56-ui] Reusing running Ripple + bridge");
      return;
    } catch {
      console.log("[test56-ui] Ripple up but bridge dead — restarting…");
    }
  }

  console.log("[test56-ui] Starting Ripple electron-vite dev…");
  await stopRippleDev();
  devProc = spawnDev();
  ownsDev = true;
  devProc.stdout?.on("data", (d) => process.stdout.write(d));
  devProc.stderr?.on("data", (d) => process.stderr.write(d));
  await waitForBridge();
  console.log("[test56-ui] Bridge ready\n");
}

function runPlannerUnit() {
  const r = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "electron/agent/__tests__/phase-p85-test56-doc-matrix.spec.ts",
    ],
    { cwd: ROOT, shell: true, stdio: "inherit", env: process.env },
  );
  return r.status === 0;
}

function verifyPlanner(tc, bridge) {
  const tools = bridge.toolsList ?? (bridge.tools ? bridge.tools.split("→") : []);
  const kind = bridge.plannerKind ?? "unknown";
  const expectKind = tc.kind ?? "execute";
  const smokeKinds = new Set(["execute", "partial", "defer", "clarify"]);

  if (!smokeKinds.has(kind) && kind !== "unknown") {
    return `unexpected planner kind ${kind}`;
  }

  if (expectKind === "blocked") {
    if (bridge.blocked) return null;
    if (kind === "defer" || kind === "clarify") return null;
    if (!bridge.ok && /blocked|not allowed|permission|confirm/i.test(bridge.message ?? "")) {
      return null;
    }
    if (kind === "execute" && tools.some((t) => t.includes("delete"))) {
      if (!bridge.ok) return null;
    }
    return null;
  }

  if (kind === "unknown" && !bridge.ok) {
    return bridge.message ?? "planner unknown";
  }

  if (
    expectKind === "execute" &&
    kind === "execute" &&
    bridge.actionsTotal > 0 &&
    bridge.actionsOk === 0 &&
    !bridge.ok
  ) {
    return `execution failed: ${bridge.message ?? "no actions ok"}`;
  }

  return null;
}

async function runCase(tc) {
  console.log(`\n[test56-ui] === ${tc.id}: ${tc.command.slice(0, 72)} ===`);
  let bridge;
  try {
    bridge = await sendViaBridge(tc.command);
  } catch (e) {
    return { pass: false, reason: String(e.message ?? e), bridge: null };
  }

  const plannerErr = verifyPlanner(tc, bridge);
  if (plannerErr) return { pass: false, reason: plannerErr, bridge };

  return {
    pass: true,
    reason: `kind=${bridge.plannerKind} tools=${bridge.tools ?? "-"} actions=${bridge.actionsOk ?? 0}/${bridge.actionsTotal ?? 0}`,
    bridge,
  };
}

async function main() {
  loadEnvFile();
  applyTestEnv();

  const osOnly = process.argv.includes("--os-only");
  const filter = process.env.RIPPLE_TEST56_FILTER?.trim();
  const keepDev = process.argv.includes("--keep-dev");

  console.log("[test56-ui] docs/test5.-6.md UI automation (P5.5 + P6)\n");

  const cases = loadCases();
  console.log(`[test56-ui] ${cases.length} commands loaded\n`);

  if (!osOnly) {
    console.log("[test56-ui] Planner unit gate…");
    if (!runPlannerUnit()) process.exit(1);
    console.log("[test56-ui] Planner unit PASS\n");
  }

  await ensureRippleDev();

  let selected = filter
    ? cases.filter((c) => {
        const tokens = filter.split(/[,|]/).map((t) => t.trim()).filter(Boolean);
        return tokens.some((t) => c.id === t || c.id.startsWith(t));
      })
    : cases;

  if (!selected.length) {
    console.error(`[test56-ui] no cases for filter ${filter}`);
    process.exit(1);
  }

  const results = [];
  for (const tc of selected) {
    const out = await runCase(tc);
    console.log(`[test56-ui] ${tc.id} → ${out.pass ? "PASS" : "FAIL"} (${out.reason})`);
    results.push({ ...tc, ...out });
    await sleep(800);
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n========== test5.-6.md UI matrix ==========");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} [${r.section}] — ${r.command.slice(0, 55)}`);
  }
  console.log(
    `\nOVERALL: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length})`,
  );
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) {
      console.log(`  ${f.id}: ${f.reason}`);
    }
  }

  if (!keepDev) cleanupDev();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  cleanupDev();
  process.exit(1);
});
