/**
 * P8.5 OS automation — self-contained like ui-test-compound-notepad-save.mjs
 * Spawns Ripple dev if needed, sends commands via file bridge (NO CDP),
 * verifies real OS outcomes (Paint pixels, clipboard, Downloads files).
 *
 * Usage:
 *   node scripts/ui-test-p85-os.mjs           # planner unit + OS
 *   node scripts/ui-test-p85-os.mjs --os-only   # OS only (Ripple already running)
 *   RIPPLE_OS_FILTER=E4-01 node scripts/ui-test-p85-os.mjs --os-only
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
const DOWNLOADS = join(homedir(), "Downloads");
const HARD_TIMEOUT_MS = 1_800_000;
const BRIDGE_PING = "__ripple_os_bridge_ping__";

let devProc = null;
let ownsDev = false;

/** Build Phase 1 + extended E4 OS test matrix. */
function buildCases() {
  /** @param {string} id @param {string} command @param {string} verify @param {number} minActions @param {{minDrags?:number,tier?:string,file?:string,expect?:RegExp}} [opts] */
  function c(id, command, verify, minActions, opts = {}) {
    return {
      id,
      command: command.toLowerCase(),
      verify,
      minActions,
      tier: opts.tier ?? "phase1",
      minDrags: opts.minDrags,
      file: opts.file,
      expect: opts.expect,
      clearClipboard: opts.clearClipboard,
    };
  }

  const phase1 = [
    // Basic app control
    c("P1-01", "open paint and draw a circle", "paint_shape", 3),
    c("P1-02", "open paint and draw a square", "paint_shape", 3),
    c("P1-03", "open paint and draw a rectangle", "paint_shape", 3),
    c("P1-04", "open paint and draw a triangle", "paint_shape", 3),
    c("P1-05", "open paint and draw a line", "paint_ink", 3),
    c("P1-06", "open paint and draw a star shape", "paint_shape", 3),
    // Multi-shape (core bug: draw 3 circles was 1 drag)
    c("P1-07", "open paint and draw a circle then draw a square", "paint_shape", 5, {
      minDrags: 2,
    }),
    c(
      "P1-08",
      "open paint and draw a triangle then draw a circle then draw a square",
      "paint_shape",
      7,
      { minDrags: 3 },
    ),
    c("P1-09", "open paint and draw 2 circles", "paint_shape", 5, {
      minDrags: 2,
    }),
    c("P1-10", "open paint and draw 3 circles", "paint_shape", 7, {
      minDrags: 3,
    }),
    c("P1-11", "open paint and draw a circle and a rectangle", "paint_shape", 5, {
      minDrags: 2,
    }),
    // Edge
    c("P1-12", "open paint and draw something", "paint_shape", 3),
    c("P1-13", "open paint and draw a random shape", "paint_shape", 3),
  ];

  const extended = [
    c("P1-E01", "open paint and draw a circle then erase it", "paint_empty", 4, {
      tier: "extended",
    }),
    c("P1-E02", "open paint and draw a square then erase it", "paint_empty", 4, {
      tier: "extended",
    }),
    c("P1-E03", "open paint and clear canvas", "paint_empty", 2, { tier: "extended" }),
    c("P1-E04", "open paint and draw a triangle and fill it", "paint_shape", 4, {
      tier: "extended",
    }),
    c("P1-E11", "open paint and fill the shape", "bridge_ok", 2, { tier: "extended" }),
    c("P1-E05", "open paint and label it Hello", "bridge_ok", 3, { tier: "extended" }),
    c("P1-E06", "open paint and draw a circle then save file test1.png", "file", 4, {
      tier: "extended",
      file: "test1.png",
      expect: /.+/,
    }),
    c("P1-E07", "open paint and switch to chrome", "chrome_foreground", 2, {
      tier: "extended",
    }),
    c(
      "P1-E08",
      "open paint and draw a circle then switch to chrome",
      "chrome_foreground",
      4,
      { tier: "extended" },
    ),
    c("P1-E09", "open paint and draw a circle then label it Ripple", "bridge_ok", 5, {
      tier: "extended",
    }),
    c(
      "P1-E10",
      "open notepad and type os save verify and save as ripple-os-save.txt in downloads",
      "file",
      3,
      {
        tier: "extended",
        file: "ripple-os-save.txt",
        expect: /os save verify/i,
      },
    ),
  ];

  const e7 = [
    c("E7-01", "open notepad and type clip os test and copy this text", "clipboard", 3, {
      tier: "e7",
      expect: /clip os test/i,
      clearClipboard: true,
    }),
    c("E7-02", "open notepad and type cut os test and cut selected content", "clipboard", 3, {
      tier: "e7",
      expect: /cut os test/i,
      clearClipboard: true,
    }),
    c(
      "E7-R01",
      "open notepad and type ripple test then select all and copy",
      "clipboard",
      3,
      { tier: "e7", expect: /ripple test/i, clearClipboard: true },
    ),
    c(
      "E7-R02",
      "open notepad and type ripple test then select all and cut",
      "clipboard",
      3,
      { tier: "e7", expect: /ripple test/i, clearClipboard: true },
    ),
    c(
      "E7-03",
      "copy ripple e7 paste seed to clipboard and open notepad and paste clipboard content",
      "bridge_ok",
      3,
      { tier: "e7", clearClipboard: true },
    ),
    c(
      "E7-04",
      "open notepad and type select all os test and select all and copy text",
      "clipboard",
      3,
      { tier: "e7", expect: /select all os test/i, clearClipboard: true },
    ),
    c("E7-05", "copy ripple e7 read test to clipboard and read clipboard", "bridge_ok", 2, {
      tier: "e7",
      clearClipboard: true,
    }),
    c("E7-06", "copy ripple e7 ui matrix to clipboard", "clipboard", 1, {
      tier: "e7",
      expect: /ripple e7 ui matrix/i,
      clearClipboard: true,
    }),
    c(
      "E7-07",
      "open notepad and type save os e7 test and save file e7-save-test.txt",
      "file",
      3,
      {
        tier: "e7",
        file: "e7-save-test.txt",
        expect: /save os e7 test/i,
      },
    ),
    c(
      "E7-08",
      "open notepad and type create os e7 test and create file e7-data.txt",
      "file",
      3,
      {
        tier: "e7",
        file: "e7-data.txt",
        expect: /create os e7 test/i,
      },
    ),
    c(
      "E7-09",
      "open notepad and type notes e7 test and save current file as e7-notes.txt",
      "file",
      3,
      {
        tier: "e7",
        file: "e7-notes.txt",
        expect: /notes e7 test/i,
      },
    ),
    c(
      "E7-10",
      "open notepad and type called e7 test and create a file called e7-called",
      "file",
      3,
      {
        tier: "e7",
        file: "e7-called.txt",
        expect: /called e7 test/i,
      },
    ),
    c(
      "E7-11",
      "open notepad and type compound copy e7 and copy this text and save file e7-compound.txt",
      "file",
      4,
      {
        tier: "e7",
        file: "e7-compound.txt",
        expect: /compound copy e7/i,
        clearClipboard: true,
      },
    ),
    c(
      "E7-12",
      "open notepad and type compound cut e7 and cut and save file e7-cut.txt",
      "file",
      4,
      {
        tier: "e7",
        file: "e7-cut.txt",
        clearClipboard: true,
      },
    ),
    c(
      "E7-13",
      "open notepad and type compound select e7 and select all and copy then save as e7-notes2.txt",
      "file",
      4,
      {
        tier: "e7",
        file: "e7-notes2.txt",
        expect: /compound select e7/i,
        clearClipboard: true,
      },
    ),
    c(
      "E7-14",
      "open notepad and type edge e7 test and copy and save file e7-edge.txt",
      "file",
      4,
      {
        tier: "e7",
        file: "e7-edge.txt",
        expect: /edge e7 test/i,
        clearClipboard: true,
      },
    ),
  ];

  return [...phase1, ...extended, ...e7];
}

const ALL = buildCases();

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

function killProc(name) {
  return ps(
    `Get-Process ${name} -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0`,
  ).catch(() => "");
}

async function killNotepadAggressive() {
  await killProc("notepad");
  await ps(
    `$p = Join-Path $env:LOCALAPPDATA 'Packages'
Get-ChildItem $p -Filter 'Microsoft.WindowsNotepad_*' -ErrorAction SilentlyContinue | ForEach-Object {
  $ts = Join-Path $_.FullName 'LocalState\\TabState'
  if (Test-Path $ts) { Get-ChildItem $ts | Remove-Item -Force -ErrorAction SilentlyContinue }
}`,
  ).catch(() => "");
  await sleep(400);
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

async function sendViaBridge(command, timeoutMs = 150_000) {
  if (!existsSync(RIPPLE_DIR)) mkdirSync(RIPPLE_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) unlinkSync(OUT_FILE);
  const id = `os-${Date.now()}`;
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
  throw new Error("bridge timeout — os-test bridge not responding");
}

function spawnDev() {
  return spawn("npx", ["electron-vite", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      RIPPLE_P85_PHASE_B: "1",
      RIPPLE_P85_PLANNER_V2: "all",
      ...(process.env.OS_TEST_LOCK_WINDOW
        ? { OS_TEST_LOCK_WINDOW: process.env.OS_TEST_LOCK_WINDOW }
        : {}),
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
        /* not ready */
      }
    }
    await sleep(800);
  }
  throw new Error("Ripple dev started but os-test bridge never became ready");
}

async function stopRippleDev() {
  const r = spawnSync("node", ["scripts/stop-dev.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  await sleep(1200);
  return r.status === 0;
}

async function ensureRippleDev() {
  const reuseDev = process.argv.includes("--reuse-dev");

  if (reuseDev && (await rippleRunning())) {
    try {
      await sendViaBridge(BRIDGE_PING, 10_000);
      console.log("[os-test] Reusing running Ripple + bridge");
      return;
    } catch {
      console.log("[os-test] Ripple running but bridge dead — restarting…");
    }
  }

  console.log("[os-test] Stopping stale dev + starting electron-vite…");
  await stopRippleDev();
  devProc = spawnDev();
  ownsDev = true;
  devProc.stdout?.on("data", (d) => process.stdout.write(d));
  devProc.stderr?.on("data", (d) => process.stderr.write(d));
  await waitForBridge();
  console.log("[os-test] Bridge ready\n");
}

const PAINT_PIXEL_PS = `
Add-Type -AssemblyName System.Drawing
$p = Get-Process mspaint -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { 'NO_PAINT'; exit 0 }
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WinRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
}
"@
$r = New-Object WinRect+RECT
[void][WinRect]::GetWindowRect($p.MainWindowHandle, [ref]$r)
$left = $r.Left + 80; $top = $r.Top + 140
$w = [Math]::Max(120, $r.Right - $r.Left - 100)
$h = [Math]::Max(120, $r.Bottom - $r.Top - 160)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$cx = [Math]::Floor($w / 2); $cy = [Math]::Floor($h / 2)
$q = @(0,0,0,0); $dark = 0
for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $c = $bmp.GetPixel($x, $y)
    if (($c.R + $c.G + $c.B) -lt 600) {
      $dark++
      $qi = $(if ($x -lt $cx -and $y -lt $cy) {0} elseif ($x -ge $cx -and $y -lt $cy) {1} elseif ($x -lt $cx -and $y -ge $cy) {2} else {3})
      $q[$qi] = 1
    }
  }
}
$g.Dispose(); $bmp.Dispose()
$quads = ($q | Measure-Object -Sum).Sum
if ($dark -lt 40) { "NO_INK dark=$dark" }
elseif ($quads -ge 3 -or $dark -gt 200) { "SHAPE_OK dark=$dark quads=$quads" }
elseif ($dark -ge 60) { "INK_OK dark=$dark quads=$quads" }
else { "LINE_ONLY dark=$dark quads=$quads" }
`;

async function verifyPaintPixels() {
  return ps(PAINT_PIXEL_PS);
}

async function verifyPaintClosed() {
  try {
    const out = await ps(
      `(Get-Process mspaint -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Measure-Object).Count`,
    );
    return Number(out) === 0;
  } catch {
    return true;
  }
}

async function clearClipboard() {
  await ps(
    `Set-Clipboard -Value "ripple-e7-baseline-${Date.now()}"`,
  ).catch(() => {});
}

async function readClipboardText() {
  return ps(`Get-Clipboard -Raw`).catch(() => "");
}

async function verifyChromeForeground() {
  try {
    const title = await ps(
      `Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder t, int n);
}
"@
$h = [Fg]::GetForegroundWindow()
$t = New-Object System.Text.StringBuilder 512
[void][Fg]::GetWindowText($h, $t, 512)
$t.ToString()`,
    );
    return /chrome/i.test(title);
  } catch {
    return false;
  }
}

async function verifyFocusLock() {
  const lock = process.env.OS_TEST_LOCK_WINDOW?.trim().toLowerCase();
  if (!lock) return null;
  try {
    const title = await ps(
      `Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Diagnostics;
public class FgLock {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [FgLock]::GetForegroundWindow()
$pid = 0
[void][FgLock]::GetWindowThreadProcessId($h, [ref]$pid)
$p = Get-Process -Id $pid -ErrorAction SilentlyContinue
"$($p.ProcessName)|$($p.MainWindowTitle)"`,
    );
    const [proc, winTitle] = title.split("|");
    const p = (proc ?? "").toLowerCase();
    if (lock === "notepad" && p.includes("cursor")) {
      return `focus violation: Cursor foreground (${winTitle?.slice(0, 40) ?? ""})`;
    }
    if (lock === "notepad" && p === "electron" && /ripple/i.test(winTitle ?? "")) {
      return `focus violation: Ripple foreground during notepad lock`;
    }
    return null;
  } catch {
    return null;
  }
}

async function runPlannerUnit() {
  const r = spawnSync(
    "npm",
    ["run", "test:p85", "--", "phase-p85-full-suite", "phase-p85-paint-draw"],
    { cwd: ROOT, shell: true, stdio: "inherit", env: process.env },
  );
  return r.status === 0;
}

function bridgePass(bridge, min) {
  if (!bridge.ok) return { pass: false, reason: bridge.message ?? "bridge ok=false" };
  if ((bridge.actionsOk ?? 0) < min) {
    return {
      pass: false,
      reason: `actions ${bridge.actionsOk}/${bridge.actionsTotal} (need ${min})`,
    };
  }
  return null;
}

async function runCase(tc) {
  await killProc("mspaint");
  await killNotepadAggressive();
  if (tc.file && existsSync(join(DOWNLOADS, tc.file))) {
    unlinkSync(join(DOWNLOADS, tc.file));
  }
  if (tc.clearClipboard) {
    await clearClipboard();
  }
  await sleep(500);

  console.log(`\n[os-test] === ${tc.id}: ${tc.command} ===`);
  let bridge;
  try {
    bridge = await sendViaBridge(tc.command);
  } catch (e) {
    return { pass: false, reason: String(e.message ?? e), bridge: null };
  }

  if (tc.command === BRIDGE_PING) {
    return { pass: bridge.ok !== false, reason: "ping", bridge };
  }

  const min = tc.minActions ?? 1;
  const fail = bridgePass(bridge, min);
  if (fail) return { ...fail, bridge };

  const focusViolation = await verifyFocusLock();
  if (focusViolation) {
    return { pass: false, reason: focusViolation, bridge };
  }

  if (tc.minDrags != null) {
    const drags =
      typeof bridge.dragSteps === "number" && bridge.dragSteps > 0
        ? bridge.dragSteps
        : Math.max(0, Math.floor(((bridge.actionsOk ?? 0) - 1) / 2));
    if (drags < tc.minDrags) {
      return {
        pass: false,
        reason: `drag steps ${drags} (need ${tc.minDrags}) — expected ${tc.minActions} plan actions, got ${bridge.actionsOk}/${bridge.actionsTotal}`,
        bridge,
      };
    }
  }

  await sleep(tc.tier === "e7" ? 5000 : 3500);

  if (tc.verify === "paint_shape") {
    const px = await verifyPaintPixels();
    if (px.startsWith("SHAPE_OK") || px.startsWith("INK_OK")) {
      return { pass: true, reason: px, bridge };
    }
    return { pass: false, reason: `pixel: ${px}`, bridge };
  }
  if (tc.verify === "paint_ink") {
    const px = await verifyPaintPixels();
    if (px.startsWith("SHAPE_OK") || px.startsWith("INK_OK") || px.startsWith("LINE_ONLY")) {
      return { pass: true, reason: px, bridge };
    }
    return { pass: false, reason: `pixel: ${px}`, bridge };
  }
  if (tc.verify === "paint_empty") {
    const px = await verifyPaintPixels();
    const dark = Number(px.match(/dark=(\d+)/)?.[1] ?? 999);
    if (px.startsWith("NO_INK") || dark < 50) {
      return { pass: true, reason: px, bridge };
    }
    return { pass: false, reason: `expected empty canvas: ${px}`, bridge };
  }
  if (tc.verify === "paint_closed") {
    const closed = await verifyPaintClosed();
    return closed
      ? { pass: true, reason: "paint closed", bridge }
      : { pass: false, reason: "paint still open", bridge };
  }
  if (tc.verify === "chrome_foreground") {
    const chrome = await verifyChromeForeground();
    return chrome
      ? { pass: true, reason: "chrome foreground", bridge }
      : { pass: false, reason: "chrome not foreground", bridge };
  }
  if (tc.verify === "clipboard") {
    const text = await readClipboardText();
    if (tc.expect?.test(text)) return { pass: true, reason: "clipboard ok", bridge };
    return { pass: false, reason: `clipboard: ${text.slice(0, 60)}`, bridge };
  }
  if (tc.verify === "file") {
    const path = join(DOWNLOADS, tc.file);
    if (!existsSync(path)) return { pass: false, reason: `no file ${tc.file}`, bridge };
    const content = readFileSync(path, "utf8");
    if (tc.expect && !tc.expect.test(content)) {
      return { pass: false, reason: `file content mismatch: ${content.slice(0, 60)}`, bridge };
    }
    return { pass: true, reason: "file ok", bridge };
  }
  return {
    pass: true,
    reason: `bridge ${bridge.actionsOk}/${bridge.actionsTotal}`,
    bridge,
  };
}

async function main() {
  loadEnvFile();
  const osOnly = process.argv.includes("--os-only");
  const phase1Only = process.argv.includes("--phase1-only");
  const e7Only = process.argv.includes("--e7-only");
  const e7ClipboardOnly = process.argv.includes("--e7-clipboard-only");
  const filter = process.env.RIPPLE_OS_FILTER?.trim();
  const keepDev = process.argv.includes("--keep-dev");

  if (e7Only || e7ClipboardOnly || filter?.startsWith("E7")) {
    process.env.OS_TEST_LOCK_WINDOW = process.env.OS_TEST_LOCK_WINDOW || "notepad";
  }

  console.log("[os-test] P8.5 OS automation (self-contained, file bridge, NO CDP)\n");

  if (!osOnly) {
    console.log("[os-test] Planner unit tests…");
    if (!(await runPlannerUnit())) process.exit(1);
    console.log("[os-test] Planner PASS\n");
  }

  await ensureRippleDev();

  let cases = filter
    ? ALL.filter((c) => c.id === filter || c.id.startsWith(filter))
    : ALL;
  if (phase1Only) {
    cases = cases.filter((c) => c.tier === "phase1");
  }
  if (e7Only) {
    cases = cases.filter((c) => c.tier === "e7");
  }
  if (e7ClipboardOnly) {
    cases = cases.filter((c) =>
      ["E7-01", "E7-02", "E7-R01", "E7-R02"].includes(c.id),
    );
  }

  const results = [];
  for (const c of cases) {
    const out = await runCase(c);
    console.log(
      `[os-test] ${c.id} → ${out.pass ? "PASS" : "FAIL"} (${out.reason})` +
        (out.bridge
          ? ` [actions ${out.bridge.actionsOk}/${out.bridge.actionsTotal}` +
            (out.bridge.dragSteps != null ? ` drags ${out.bridge.dragSteps}` : "") +
            "]"
          : ""),
    );
    results.push({ ...c, ...out });
    await sleep(1200);
  }

  const failed = results.filter((r) => !r.pass);
  const phase1Results = results.filter((r) => r.tier === "phase1");
  const phase1Failed = phase1Results.filter((r) => !r.pass);
  const e7Results = results.filter((r) => r.tier === "e7");
  const e7Failed = e7Results.filter((r) => !r.pass);
  console.log("\n========== OS TEST ==========");
  for (const r of results) {
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id} [${r.tier}] — ${r.command.slice(0, 55)}`,
    );
  }
  console.log(
    `\nPHASE1: ${phase1Failed.length === 0 ? "PASS" : "FAIL"} (${phase1Results.length - phase1Failed.length}/${phase1Results.length})`,
  );
  if (e7Results.length) {
    console.log(
      `E7: ${e7Failed.length === 0 ? "PASS" : "FAIL"} (${e7Results.length - e7Failed.length}/${e7Results.length})`,
    );
  }
  console.log(
    `OVERALL: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length})`,
  );
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ${f.id}: ${f.reason}`);
  }
  console.log("=============================\n");

  if (!keepDev) cleanupDev();
  const exitCode =
    phase1Only
      ? phase1Failed.length > 0
        ? 1
        : 0
      : e7Only
        ? e7Failed.length > 0
          ? 1
          : 0
        : filter
          ? failed.length > 0
            ? 1
            : 0
          : failed.length > 0
            ? 1
            : 0;
  process.exit(exitCode);
}

const timer = setTimeout(() => {
  console.error("[os-test] HARD TIMEOUT");
  cleanupDev();
  process.exit(1);
}, HARD_TIMEOUT_MS);

main()
  .catch((e) => {
    console.error("[os-test] FATAL:", e);
    cleanupDev();
    process.exit(1);
  })
  .finally(() => clearTimeout(timer));
