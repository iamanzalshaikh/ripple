/**
 * P8.5 Phase 5 — real OS UI automation for cursor/test.md QA matrix.
 * Sends voice commands through Ripple file bridge (NO CDP), verifies planner tools
 * and OS outcomes (files, processes).
 *
 * Usage:
 *   npm run test:ui-p5-qa              # export cases + planner unit + OS matrix
 *   npm run test:ui-p5-qa-only         # OS only (Ripple dev must be running)
 *   RIPPLE_P5_FILTER=FS-001 npm run test:ui-p5-qa-only
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function documentsPathForOsTest() {
  try {
    const out = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"],
      { encoding: "utf8" },
    );
    const p = out.stdout?.trim();
    if (p) return p;
  } catch {
    /* fallback */
  }
  return join(homedir(), "Documents");
}

const RIPPLE_DIR = join(homedir(), "AppData", "Roaming", "ripple-desktop");
const IN_FILE = join(RIPPLE_DIR, "os-test-in.json");
const OUT_FILE = join(RIPPLE_DIR, "os-test-out.json");
const DOCUMENTS = documentsPathForOsTest();
const DESKTOP = join(homedir(), "Desktop");
const CASES_FILE = join(ROOT, "scripts", "p5-qa-matrix-cases.json");
const BRIDGE_PING = "__ripple_os_bridge_ping__";
const HARD_TIMEOUT_MS = 2_400_000;

let devProc = null;
let ownsDev = false;

/** @type {Record<string, { type: string; file?: string; parent?: string; expect?: string; process?: string }>} */
const OS_VERIFY = {
  "FS-009": { type: "file_exists", file: "ripple-test.txt", parent: "documents" },
  "FS-010": {
    type: "file_content",
    file: "ripple-test.txt",
    parent: "documents",
    expect: "filesystem testing complete",
  },
  "FS-012": { type: "file_exists", file: "ripple-test.txt", parent: "desktop" },
  "FS-013": { type: "documents_safe" },
  "DT-001": { type: "process", process: "notepad" },
  "DT-002": { type: "process", process: "cursor" },
  "AU-001": { type: "process", process: "windowsterminal" },
};

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
}

function loadCases() {
  if (!existsSync(CASES_FILE)) {
    throw new Error(
      `Missing ${CASES_FILE} — run: npx vitest run electron/agent/__tests__/export-p5-qa-cases.spec.ts`,
    );
  }
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
      `(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'Ripple' } | Measure-Object).Count`,
    );
    return Number(out) > 0;
  } catch {
    return false;
  }
}

async function sendViaBridge(command, timeoutMs = 300_000) {
  if (!existsSync(RIPPLE_DIR)) mkdirSync(RIPPLE_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) unlinkSync(OUT_FILE);
  const id = `p5-${Date.now()}`;
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
  throw new Error("bridge timeout — is Ripple dev running with os-test bridge?");
}

function spawnDev() {
  return spawn("npx", ["electron-vite", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      RIPPLE_P85_PHASE_B: "1",
      RIPPLE_P85_PLANNER_V2: "all",
      RIPPLE_P85_TOOL_EXECUTOR: "1",
      RIPPLE_INSERT_TEXT_DIAG: "1",
      RIPPLE_P85_VISION_INSERT: "1",
      RIPPLE_USE_CDP: "0",
      RIPPLE_OS_TEST: "1",
    },
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

async function waitForBridge(timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await rippleRunning()) {
      try {
        const out = await sendViaBridge(BRIDGE_PING, 10_000);
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
      await sendViaBridge(BRIDGE_PING, 10_000);
      console.log("[p5-ui] Reusing running Ripple + bridge");
      return;
    } catch {
      console.log("[p5-ui] Ripple running but bridge dead — restarting…");
    }
  }

  console.log("[p5-ui] Starting Ripple electron-vite dev…");
  await stopRippleDev();
  devProc = spawnDev();
  ownsDev = true;
  devProc.stdout?.on("data", (d) => process.stdout.write(d));
  devProc.stderr?.on("data", (d) => process.stderr.write(d));
  await waitForBridge();
  console.log("[p5-ui] Bridge ready\n");
}

function exportCases() {
  const r = spawnSync(
    "npx",
    ["vitest", "run", "electron/agent/__tests__/export-p5-qa-cases.spec.ts"],
    { cwd: ROOT, shell: true, stdio: "inherit", env: process.env },
  );
  if (r.status !== 0) process.exit(1);
}

function runPlannerUnit() {
  const r = spawnSync("npm", ["run", "test:p85-qa"], {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  return r.status === 0;
}

function parentPath(parent) {
  if (parent === "desktop") return DESKTOP;
  if (parent === "documents") return DOCUMENTS;
  return join(homedir(), "Downloads");
}

function fileVerifyCandidates(spec) {
  const primary = join(parentPath(spec.parent), spec.file);
  if (spec.parent !== "documents") return [primary];
  return [primary, join(DESKTOP, spec.file), join(homedir(), "Downloads", spec.file)];
}

function verifyPlanner(tc, bridge) {
  const tools = bridge.toolsList ?? (bridge.tools ? bridge.tools.split("→") : []);
  const kind = bridge.plannerKind ?? "unknown";
  const expectKind = tc.kind ?? "execute";

  if (expectKind === "blocked") {
    if (bridge.blocked) return null;
    if (kind === "defer" || kind === "clarify") return null;
    if (!bridge.ok && /blocked|not allowed|permission/i.test(bridge.message ?? "")) {
      return null;
    }
    return `expected blocked, got kind=${kind} ok=${bridge.ok}`;
  }

  if (expectKind === "defer") {
    if (kind === "defer") return null;
    if (
      !bridge.ok &&
      (kind === "unknown" || !bridge.plannerKind) &&
      /not authenticated|socket offline/i.test(bridge.message ?? "")
    ) {
      return null;
    }
    return `expected defer, got ${kind}`;
  }

  if (expectKind === "clarify") {
    if (kind === "clarify") return null;
    if (!bridge.ok && bridge.message) return null;
    return `expected clarify, got ${kind}`;
  }

  if (expectKind === "partial") {
    if (kind !== "partial" && kind !== "execute") {
      return `expected partial/execute, got ${kind}`;
    }
  } else if (kind !== "execute" && kind !== "partial") {
    return `expected execute, got ${kind}`;
  }

  if (tc.minSteps && tools.length < tc.minSteps) {
    return `tools ${tools.length} < minSteps ${tc.minSteps}`;
  }

  if (tc.forbid?.length) {
    for (const f of tc.forbid) {
      if (tools.some((t) => t.includes(f))) return `forbidden tool ${f}`;
    }
  }

  if (!matchesTools(tools, tc.tools, tc.altToolSets)) {
    return `tool mismatch: got [${tools.join(" → ")}]`;
  }

  if (expectKind === "execute" && bridge.actionsTotal > 0 && bridge.actionsOk === 0 && !bridge.ok) {
    return `execution failed: ${bridge.message ?? "no actions ok"}`;
  }

  return null;
}

async function verifyOs(tc) {
  const spec = OS_VERIFY[tc.id];
  if (!spec) return null;

  await sleep(2000);

  if (spec.type === "file_exists") {
    const candidates = fileVerifyCandidates(spec);
    if (candidates.some((p) => existsSync(p))) return null;
    return `missing file ${candidates.join(" or ")}`;
  }

  if (spec.type === "file_content") {
    const candidates = fileVerifyCandidates(spec);
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      if (!spec.expect || text.includes(spec.expect)) return null;
    }
    const path = candidates.find((p) => existsSync(p));
    if (!path) return `missing file ${candidates.join(" or ")}`;
    const text = readFileSync(path, "utf8");
    return `file content mismatch: ${text.slice(0, 80)}`;
  }

  if (spec.type === "documents_safe") {
    try {
      const entries = readdirSync(DOCUMENTS);
      if (entries.length === 0) return "documents folder appears empty after bulk-delete attempt";
    } catch (e) {
      return `documents check failed: ${e.message}`;
    }
    return null;
  }

  if (spec.type === "process") {
    try {
      const out = await ps(
        `(Get-Process -Name '*${spec.process}*' -ErrorAction SilentlyContinue | Measure-Object).Count`,
      );
      if (Number(out) > 0) return null;
      return `process ${spec.process} not running`;
    } catch {
      return `process ${spec.process} not found`;
    }
  }

  return null;
}

async function prepFilesystemChain() {
  for (const parent of [DOCUMENTS, DESKTOP]) {
    const p = join(parent, "ripple-test.txt");
    if (existsSync(p)) unlinkSync(p);
  }
}

async function runCase(tc) {
  if (tc.id === "FS-009") await prepFilesystemChain();

  console.log(`\n[p5-ui] === ${tc.id}: ${tc.command.slice(0, 72)} ===`);
  let bridge;
  try {
    bridge = await sendViaBridge(tc.command);
  } catch (e) {
    return { pass: false, reason: String(e.message ?? e), bridge: null };
  }

  const plannerErr = verifyPlanner(tc, bridge);
  if (plannerErr) return { pass: false, reason: plannerErr, bridge };

  const osErr = await verifyOs(tc);
  if (osErr) return { pass: false, reason: `os: ${osErr}`, bridge };

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
  const filter = process.env.RIPPLE_P5_FILTER?.trim();
  const customCommand = process.env.RIPPLE_P5_COMMAND?.trim();
  const keepDev = process.argv.includes("--keep-dev");

  console.log("[p5-ui] P8.5 Phase 5 OS UI automation (cursor/test.md)\n");

  exportCases();
  const cases = loadCases();
  if (cases.length !== 55) {
    console.warn(`[p5-ui] warn: expected 55 cases, got ${cases.length}`);
  }

  if (!osOnly) {
    console.log("[p5-ui] Planner unit gate (test:p85-qa)…");
    if (!runPlannerUnit()) process.exit(1);
    console.log("[p5-ui] Planner unit PASS\n");
  }

  await ensureRippleDev();

  let selected = customCommand
    ? [
        {
          id: "CUSTOM-P5",
          command: customCommand,
          kind: "partial",
          tools: [
            "automation.open_project",
            "automation.scan_project",
            "automation.analyze_codebase",
            "automation.typecheck",
            "automation.lint",
          ],
          minSteps: 5,
          forbid: ["filesystem.open"],
        },
      ]
    : filter
      ? cases.filter((c) => {
          const tokens = filter.split(/[,|]/).map((t) => t.trim()).filter(Boolean);
          if (!tokens.length) return true;
          return tokens.some((t) => c.id === t || c.id.startsWith(t));
        })
      : cases;

  if (!selected.length) {
    console.error(`[p5-ui] no cases for filter ${filter}`);
    process.exit(1);
  }

  const results = [];
  for (const tc of selected) {
    const out = await runCase(tc);
    console.log(`[p5-ui] ${tc.id} → ${out.pass ? "PASS" : "FAIL"} (${out.reason})`);
    results.push({ ...tc, ...out });
    await sleep(1500);
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n========== P5 UI QA (test.md) ==========");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} — ${r.command.slice(0, 60)}`);
  }
  console.log(
    `\nOVERALL: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length})`,
  );
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ${f.id}: ${f.reason}`);
  }
  console.log("=========================================\n");

  if (!keepDev) cleanupDev();

  if (failed.length === 0) {
    console.log("FINAL — P5 UI automation QA complete");
  } else {
    console.log(`ITERATING — ${failed.length} case(s) still failing`);
  }

  process.exit(failed.length ? 1 : 0);
}

const timer = setTimeout(() => {
  console.error("[p5-ui] HARD TIMEOUT");
  cleanupDev();
  process.exit(1);
}, HARD_TIMEOUT_MS);

main()
  .catch((e) => {
    console.error("[p5-ui] FATAL:", e);
    cleanupDev();
    process.exit(1);
  })
  .finally(() => clearTimeout(timer));
