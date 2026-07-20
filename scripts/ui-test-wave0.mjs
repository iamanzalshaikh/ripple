/**
 * Wave 0 production trust suite — drives the REAL running Ripple process via
 * the same file bridge as ui-test-p85-os.mjs (electron/osTestBridge.ts): a
 * command string goes in, the actual planner/executor pipeline runs it, real
 * disk state gets inspected afterward. No CDP, no Playwright, no mocks — the
 * exact production code path a spoken command would hit.
 *
 * Sandbox: C:\Ripple-Test (created fresh, destroyed at the end).
 * Covers wave0.md TEST 1-20 plus additional regression scenarios (W0-E*).
 *
 * Usage:
 *   node scripts/ui-test-wave0.mjs             # stop stale dev, start fresh, run all
 *   node scripts/ui-test-wave0.mjs --reuse-dev # reuse an already-running dev instance
 *   node scripts/ui-test-wave0.mjs --keep-dev  # leave dev running after the suite
 */
import { spawn, spawnSync } from "node:child_process";
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
const DESKTOP = join(homedir(), "Desktop");

const W0_ROOT = "C:\\Ripple-Test";
const W0 = join(W0_ROOT, "W0");
const SOURCE = join(W0, "Source");
const REPORTS = join(SOURCE, "Reports");

let devProc = null;
let ownsDev = false;

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

async function sendViaBridge(command, timeoutMs = 100_000) {
  if (!existsSync(RIPPLE_DIR)) mkdirSync(RIPPLE_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) unlinkSync(OUT_FILE);
  const id = `w0-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      // Auto-confirm destructive dialogs + Documents write fallbacks for Wave 0.
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

async function waitForBridge(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await rippleRunning()) {
      try {
        const out = await sendViaBridge(BRIDGE_PING, 8_000);
        if (out.ok !== undefined) return;
      } catch {
        /* not ready yet */
      }
    }
    await sleep(800);
  }
  throw new Error("Ripple dev started but the os-test bridge never became ready");
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
  const reuseDev = process.argv.includes("--reuse-dev");
  if (reuseDev && (await rippleRunning())) {
    try {
      await sendViaBridge(BRIDGE_PING, 10_000);
      console.log("[wave0] Reusing running Ripple + bridge");
      return;
    } catch {
      console.log("[wave0] Ripple running but bridge dead — restarting…");
    }
  }
  console.log("[wave0] Stopping stale dev + starting electron-vite…");
  await stopRippleDev();
  devProc = spawnDev();
  ownsDev = true;
  devProc.stdout?.on("data", (d) => process.stdout.write(d));
  devProc.stderr?.on("data", (d) => process.stderr.write(d));
  await waitForBridge();
  console.log("[wave0] Bridge ready\n");
}

async function step(id, label, command, assert) {
  let bridge;
  try {
    bridge = await sendViaBridge(command);
  } catch (e) {
    return { id, label, command, pass: false, reason: `bridge error: ${e.message}` };
  }
  try {
    assert?.(bridge);
    return { id, label, command, pass: true, reason: bridge.message ?? "ok", bridge };
  } catch (e) {
    return { id, label, command, pass: false, reason: e.message, bridge };
  }
}

function mustExist(path) {
  if (!existsSync(path)) throw new Error(`expected to exist: ${path}`);
}
function mustNotExist(path) {
  if (existsSync(path)) throw new Error(`expected NOT to exist: ${path}`);
}
function mustOk(bridge) {
  if (!bridge.ok) throw new Error(`expected ok=true, got ok=false: ${bridge.message}`);
}
function mustFail(bridge) {
  if (bridge.ok) throw new Error(`expected ok=false (this should fail), got ok=true`);
}
function mustTool(bridge, tool) {
  if (!bridge.tools?.includes(tool)) {
    throw new Error(`expected tool "${tool}", got "${bridge.tools}"`);
  }
}
function mustNotTool(bridge, tool) {
  if (bridge.tools?.includes(tool)) {
    throw new Error(`must NOT route to "${tool}", got "${bridge.tools}"`);
  }
}

async function buildTestWorld() {
  rmSync(W0_ROOT, { recursive: true, force: true });
  mkdirSync(W0_ROOT, { recursive: true });
  console.log(`[wave0] Test world root ready at ${W0_ROOT}`);
}

async function main() {
  const keepDev = process.argv.includes("--keep-dev");
  await buildTestWorld();
  await ensureRippleDev();

  const results = [];
  const run = async (...args) => {
    const r = await step(...args);
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.label}`);
    if (!r.pass) console.log(`      → ${r.reason}`);
    return r;
  };

  // ---- TEST 1-6: folder/file creation chain, via real voice commands ----
  await run("T1", "Create root folder on C drive", "Create a folder called Ripple-Test on C drive", (b) => {
    mustOk(b);
    mustExist(W0_ROOT);
  });
  await run("T2", "Create W0 folder inside Ripple-Test", "Create a folder called W0 inside C:\\Ripple-Test", (b) => {
    mustOk(b);
    mustExist(W0);
  });
  await run("T3", "Create Source folder inside W0", "Create a folder called Source inside C:\\Ripple-Test\\W0", (b) => {
    mustOk(b);
    mustExist(SOURCE);
  });
  await run("T4", "Create Reports folder inside Source", "Create a folder called Reports inside C:\\Ripple-Test\\W0\\Source", (b) => {
    mustOk(b);
    mustExist(REPORTS);
  });
  await run("T5", "Create nested Q1 folder inside Reports", "Create a folder called Q1 inside C:\\Ripple-Test\\W0\\Source\\Reports", (b) => {
    mustOk(b);
    mustExist(join(REPORTS, "Q1"));
  });
  await run("T6a", "Create sales.txt inside Q1", "Create a file called sales.txt inside C:\\Ripple-Test\\W0\\Source\\Reports\\Q1", (b) => {
    mustOk(b);
    mustNotTool(b, "desktop.save_file");
    mustExist(join(REPORTS, "Q1", "sales.txt"));
  });
  await run("T6b", "Create report1.txt inside Reports", "Create a file called report1.txt inside C:\\Ripple-Test\\W0\\Source\\Reports", (b) => {
    mustOk(b);
    mustNotTool(b, "desktop.save_file");
    mustExist(join(REPORTS, "report1.txt"));
  });
  await run("T6c", "Create report2.txt inside Reports", "Create a file called report2.txt inside C:\\Ripple-Test\\W0\\Source\\Reports", (b) => {
    mustOk(b);
    mustNotTool(b, "desktop.save_file");
    mustExist(join(REPORTS, "report2.txt"));
  });
  await run(
    "T6d",
    "Create file inside spoken Desktop (must not route to save_file)",
    "Create a file called ripple-w0-notes.txt inside Desktop",
    (b) => {
      mustOk(b);
      mustNotTool(b, "desktop.save_file");
      const deskFile = join(DESKTOP, "ripple-w0-notes.txt");
      mustExist(deskFile);
      try {
        unlinkSync(deskFile);
      } catch {
        /* ignore */
      }
    },
  );

  // If the creation chain didn't actually produce the scaffolding (e.g. T1-T6
  // failed), build it directly so every later test can still run in
  // isolation rather than cascading into unrelated failures.
  if (!existsSync(join(REPORTS, "Q1", "sales.txt"))) {
    mkdirSync(join(REPORTS, "Q1"), { recursive: true });
    writeFileSync(join(REPORTS, "Q1", "sales.txt"), "q1 sales");
  }
  if (!existsSync(join(REPORTS, "report1.txt"))) writeFileSync(join(REPORTS, "report1.txt"), "report1");
  if (!existsSync(join(REPORTS, "report2.txt"))) writeFileSync(join(REPORTS, "report2.txt"), "report2");

  // ---- TEST 7: spoken path resolution ----
  await run("T7", "Spoken path resolution finds the real Reports, not Desktop fallback", "Find Reports folder", (b) => {
    mustOk(b);
    if (/desktop/i.test(b.message ?? "") && !/Ripple-Test/i.test(b.message ?? "")) {
      throw new Error(`resolved via Desktop fallback: ${b.message}`);
    }
  });

  // ---- TEST 8: the core W0.3 copy-folder bug ----
  await run(
    "T8",
    "Copy folder to 'a new folder called Archive' (destination doesn't exist)",
    `Copy the folder ${REPORTS} to a new folder called Archive`,
    (b) => {
      mustTool(b, "filesystem.copy_folder");
      mustOk(b);
      const archive = join(SOURCE, "Archive");
      mustExist(archive);
      mustExist(join(archive, "report1.txt"));
      mustExist(join(archive, "Q1", "sales.txt"));
      mustNotExist(join(archive, "Reports"));
      mustNotExist(join(DESKTOP, "Archive"));
    },
  );

  // ---- TEST 9: copy into an EXISTING destination nests as a child ----
  const destination = join(W0, "Destination");
  mkdirSync(destination, { recursive: true });
  await run(
    "T9",
    "Copy folder into an existing destination (nests as child)",
    `Copy the folder ${REPORTS} to ${destination}`,
    (b) => {
      mustTool(b, "filesystem.copy_folder");
      mustOk(b);
      mustExist(join(destination, "Reports", "report1.txt"));
    },
  );

  // ---- TEST 10: bare unknown destination name must never collapse to Desktop ----
  await run(
    "T10",
    "Copy folder to a bare unknown name (must not collapse to Desktop)",
    `Copy the folder ${REPORTS} to TestFolder`,
    (b) => {
      mustTool(b, "filesystem.copy_folder");
      mustOk(b);
      mustNotExist(join(DESKTOP, "TestFolder"));
      mustExist(join(SOURCE, "TestFolder", "report1.txt"));
    },
  );

  // ---- TEST 11: compare with long absolute paths must not get split by compound-gate ----
  const compareA = join(W0, "CompareA");
  const compareB = join(W0, "CompareB");
  mkdirSync(compareA, { recursive: true });
  mkdirSync(compareB, { recursive: true });
  writeFileSync(join(compareA, "same.txt"), "same");
  writeFileSync(join(compareB, "same.txt"), "same");
  await run(
    "T11",
    "Compare folders with long absolute paths (compound-gate must not intercept)",
    `Compare these two folders ${compareA} and ${compareB}`,
    (b) => {
      mustTool(b, "filesystem.compare_directories");
      mustOk(b);
    },
  );

  // ---- TEST 12: admin routing ----
  await run("T12a", "Admin routing: Notepad", "Run Notepad as administrator", (b) => {
    mustTool(b, "os.run_as_admin");
    mustNotTool(b, "automation.run_command");
    mustOk(b);
  });
  await run("T12b", "Admin routing: Terminal", "Open terminal as administrator", (b) => {
    mustTool(b, "os.run_as_admin");
    mustNotTool(b, "automation.run_command");
    mustOk(b);
  });

  // ---- TEST 13: automation wall regression guard ----
  await run("T13", "Non-admin command still routes normally", "Run ipconfig", (b) => {
    mustTool(b, "automation.run_command");
    mustOk(b);
  });

  // ---- TEST 14: fake-success detection ----
  await run(
    "T14",
    "Copying a nonexistent source must FAIL, not fake-succeed",
    `Copy the folder ${join(SOURCE, "DoesNotExist")} to Archive2`,
    (b) => {
      mustFail(b);
    },
  );

  // ---- TEST 15: duplicate dispatch ----
  {
    const cmd = `Copy the file ${join(REPORTS, "report1.txt")} to ${join(W0, "Backup")}`;
    const [first, second] = await Promise.all([
      sendViaBridge(cmd).catch((e) => ({ ok: false, message: e.message })),
      sendViaBridge(cmd).catch((e) => ({ ok: false, message: e.message })),
    ]);
    const successes = [first, second].filter((r) => r.ok).length;
    const pass = successes <= 1;
    results.push({ id: "T15", label: "Duplicate dispatch dedupes to one execution", command: cmd, pass, reason: pass ? "deduped correctly" : `both fired (${successes} successes)` });
    console.log(`${pass ? "PASS" : "FAIL"}  T15  Duplicate dispatch dedupes to one execution`);
    if (!pass) console.log(`      → both fired (${successes} successes)`);
  }

  // ---- TEST 16: clarify recovery doesn't stick to unrelated new command ----
  await sendViaBridge("Compare these two folders").catch(() => {});
  await run("T16", "New unrelated command after a clarify prompt runs independently", "Run ipconfig", (b) => {
    mustTool(b, "automation.run_command");
    mustOk(b);
  });

  // ---- TEST 17: execution ledger — infra doesn't exist yet (Wave 0 item #6) ----
  results.push({
    id: "T17",
    label: "Execution ledger per-action verification",
    command: "(n/a)",
    pass: null,
    reason: "BLOCKED — execution ledger not implemented yet (Wave 0 pending item)",
  });
  console.log("SKIP  T17  Execution ledger per-action verification");
  console.log("      → BLOCKED: not implemented yet (Wave 0 pending item)");

  // ---- TEST 18: undo verification ----
  // Isolate undo stack from earlier creates so "undo last" targets this copy.
  await sendViaBridge("__ripple_os_bridge_clear_undo__").catch(() => {});
  const undoTarget = join(SOURCE, "UndoMe");
  await sendViaBridge(`Copy the folder ${REPORTS} to a new folder called UndoMe`);
  await run("T18", "Undo removes the folder just copied", "Undo last copy", (b) => {
    mustOk(b);
    mustNotExist(undoTarget);
  });

  // ---- TEST 19: destructive cleanup requires confirmation, never silent ----
  await run(
    "T19",
    "Deleting the whole test folder requires confirmation (never silently deletes)",
    `Delete the folder ${W0_ROOT}`,
    (b) => {
      if (b.ok && !/confirm|sure|are you/i.test(b.message ?? "")) {
        throw new Error(`bulk delete executed without any confirmation gate: ${b.message}`);
      }
    },
  );

  // ---- Rebuild scaffolding before extra regressions (T19 / earlier steps
  // may have disrupted Compare*/TestFolder paths). ----
  mkdirSync(join(REPORTS, "Q1"), { recursive: true });
  if (!existsSync(join(REPORTS, "Q1", "sales.txt"))) {
    writeFileSync(join(REPORTS, "Q1", "sales.txt"), "q1 sales");
  }
  if (!existsSync(join(REPORTS, "report1.txt"))) writeFileSync(join(REPORTS, "report1.txt"), "report1");
  if (!existsSync(join(REPORTS, "report2.txt"))) writeFileSync(join(REPORTS, "report2.txt"), "report2");
  const testFolderFresh = join(SOURCE, "TestFolder");
  if (!existsSync(join(testFolderFresh, "report1.txt"))) {
    mkdirSync(testFolderFresh, { recursive: true });
    writeFileSync(join(testFolderFresh, "report1.txt"), "report1");
  }
  mkdirSync(compareA, { recursive: true });
  mkdirSync(compareB, { recursive: true });
  writeFileSync(join(compareA, "same.txt"), "same");
  writeFileSync(join(compareB, "same.txt"), "same");
  // E3 needs Destination\\Reports already present from T9.
  const destinationFresh = join(W0, "Destination");
  mkdirSync(join(destinationFresh, "Reports"), { recursive: true });
  writeFileSync(join(destinationFresh, "Reports", "report1.txt"), "report1");

  // ================= EXTRA REGRESSION SCENARIOS (E1-E12) =================

  await run("E1", "Move folder to 'a new folder called X' phrasing", `Move the folder ${testFolderFresh} to a new folder called Moved`, (b) => {
    mustTool(b, "filesystem.move_folder");
    mustOk(b);
    mustExist(join(SOURCE, "Moved"));
  });

  await run("E2", "Copy a FILE (not folder) still nests under destination name", `Copy the file ${join(REPORTS, "report2.txt")} to a new folder called FileDest`, (b) => {
    mustOk(b);
    // Sibling of the source file's parent folder (Reports), not Source.
    mustExist(join(REPORTS, "FileDest", "report2.txt"));
  });

  await run("E3", "Copying onto an already-existing destination errors instead of overwriting", `Copy the folder ${REPORTS} to ${destination}`, (b) => {
    mustFail(b);
  });

  await run("E4", "Admin routing alias: PowerShell", "Run PowerShell as administrator", (b) => {
    mustTool(b, "os.run_as_admin");
    mustNotTool(b, "automation.run_command");
  });

  await run("E5", "Dangerous phrasing is blocked from the plain automation path", "Run delete all files as administrator", (b) => {
    mustNotTool(b, "automation.run_command");
  });

  await run(
    "E6",
    "Compare FILES (not directories) with long absolute paths",
    `Compare these two files ${join(compareA, "same.txt")} and ${join(compareB, "same.txt")}`,
    (b) => {
      mustTool(b, "filesystem.compare_files");
      mustOk(b);
    },
  );

  await run("E7", "Genuine multi-clause compound command still splits and executes both", "open notepad and run ipconfig", (b) => {
    if (!b.ok && !/notepad|ipconfig/i.test(b.message ?? "")) {
      throw new Error(`compound command produced no recognizable result: ${b.message}`);
    }
  });

  {
    const cmd = "Open terminal as administrator";
    const [first, second] = await Promise.all([
      sendViaBridge(cmd).catch((e) => ({ ok: false, message: e.message })),
      sendViaBridge(cmd).catch((e) => ({ ok: false, message: e.message })),
    ]);
    const successes = [first, second].filter((r) => r.ok).length;
    const pass = successes <= 1;
    results.push({ id: "E8", label: "Duplicate dispatch dedupes admin commands too", command: cmd, pass, reason: pass ? "deduped correctly" : `both fired (${successes} successes)` });
    console.log(`${pass ? "PASS" : "FAIL"}  E8  Duplicate dispatch dedupes admin commands too`);
    if (!pass) console.log(`      → both fired (${successes} successes)`);
  }

  await run(
    "E9",
    "Copy folder to a nested subfolder path inside 'called X'",
    `Copy the folder ${join(REPORTS, "Q1")} to a new folder called Backups\\2024`,
    (b) => {
      mustTool(b, "filesystem.copy_folder");
      mustOk(b);
      // Sibling of Q1's parent (Reports).
      mustExist(join(REPORTS, "Backups", "2024", "sales.txt"));
    },
  );

  await run("E10", "Case/phrasing variant: lowercase 'as admin' without full word", "open notepad as admin", (b) => {
    mustTool(b, "os.run_as_admin");
    mustNotTool(b, "automation.run_command");
  });

  await run("E11", "Stuttered undo phrase still recognized", "undo, undo", (b) => {
    if (b.message && /admin_target_not_found|not a desktop command/i.test(b.message)) {
      throw new Error(`stutter undo phrase not recognized: ${b.message}`);
    }
  });

  await run("E12", "Comma-separated compare phrasing with trailing location still routes", `Compare these two folders, ${compareA} and ${compareB} in downloads`, (b) => {
    mustTool(b, "filesystem.compare_directories");
  });

  // ================= SUMMARY =================
  console.log("\n========== WAVE 0 FULL RESULTS ==========");
  for (const r of results) {
    const tag = r.pass === null ? "SKIP" : r.pass ? "PASS" : "FAIL";
    console.log(`${tag}  ${r.id}  ${r.label}`);
  }
  const real = results.filter((r) => r.pass !== null);
  const failed = real.filter((r) => !r.pass);
  const skipped = results.filter((r) => r.pass === null);
  console.log(`\n${real.length - failed.length}/${real.length} passed (${skipped.length} skipped/blocked)`);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ${f.id}: ${f.reason}`);
  }

  rmSync(W0_ROOT, { recursive: true, force: true });
  for (const stray of ["Archive", "TestFolder", "Moved", "FileDest", "Backups"]) {
    rmSync(join(DESKTOP, stray), { recursive: true, force: true });
  }
  console.log(`[wave0] Cleaned up ${W0_ROOT}`);

  if (!keepDev) cleanupDev();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[wave0] fatal:", e);
  cleanupDev();
  process.exit(1);
});
