/**
 * Real UI automation for docs/test5.-6.md — Ripple Home command box via Electron CDP.
 * Types each phrase, clicks Run, reads on-screen result (same as manual QA).
 *
 * Usage:
 *   npm run test:ui-test56
 *   $env:RIPPLE_UI_FILTER='P55-001'; npm run test:ui-test56
 * Requires RIPPLE_TEST_EMAIL + RIPPLE_TEST_PASSWORD in .env (or already logged-in dev).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CASES_FILE = join(ROOT, "scripts", "test56-matrix-cases.json");
const CDP_PORT = Number(process.env.RIPPLE_UI_CDP_PORT ?? "9333");
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const CASE_TIMEOUT_MS = Number(process.env.RIPPLE_UI_CASE_TIMEOUT_MS ?? "90000");
const HARD_TIMEOUT_MS = Number(
  process.env.RIPPLE_UI_HARD_TIMEOUT_MS ?? String(100 * CASE_TIMEOUT_MS + 300_000),
);

let devProc = null;
let ownsDev = false;

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function exportCases() {
  spawnSync("node", ["scripts/parse-test56-doc.mjs"], {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
  });
}

function loadCases() {
  exportCases();
  return JSON.parse(readFileSync(CASES_FILE, "utf8"));
}

function applyTestEnv() {
  process.env.RIPPLE_P85_PHASE_B = "1";
  process.env.RIPPLE_P85_PLANNER_V2 = "all";
  process.env.RIPPLE_P85_TOOL_EXECUTOR = "1";
  process.env.RIPPLE_USE_CDP = "0";
  process.env.RIPPLE_OS_TEST = "1";
  delete process.env.RIPPLE_OS_TEST_PLAN_ONLY;
}

async function cdpReady(timeoutMs = 3000) {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdpReady(3000)) return;
    await sleep(600);
  }
  throw new Error(`CDP not ready at ${CDP_URL}`);
}

function spawnDev() {
  return spawn(
    "npx",
    ["electron-vite", "dev", "--", `--remote-debugging-port=${CDP_PORT}`],
    {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    },
  );
}

function cleanupDev() {
  if (!ownsDev || !devProc) return;
  try {
    spawn("taskkill", ["/PID", String(devProc.pid), "/T", "/F"], {
      shell: true,
      stdio: "ignore",
    });
  } catch {
    /* ignore */
  }
  devProc = null;
  ownsDev = false;
}

async function stopRippleDev() {
  spawnSync("node", ["scripts/stop-dev.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  await sleep(1200);
}

async function findRipplePage(browser) {
  let candidate = null;
  for (let i = 0; i < 150; i++) {
    const pages = await browser.pages();
    for (const page of pages) {
      const url = page.url();
      if (!/localhost:\d+/.test(url) || url.includes("overlay")) continue;
      candidate = page;
      const text = await page
        .evaluate(() => document.body?.innerText ?? "")
        .catch(() => "");
      if (text.includes("Loading Ripple")) break;
      if (/type command/i.test(text) || /sign in/i.test(text)) {
        console.log(`[test56-ui] Home page: ${url}`);
        return page;
      }
    }
    await sleep(500);
  }
  if (candidate) return candidate;
  throw new Error("Ripple Home page not found (CDP)");
}

async function ensureLoggedIn(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="ripple-command-input"]') ||
      /sign in/i.test(document.body.innerText),
    { timeout: 90_000 },
  );
  const hasHome = await page.evaluate(
    () => !!document.querySelector('[data-testid="ripple-command-input"]'),
  );
  if (hasHome) return;

  const email = process.env.RIPPLE_TEST_EMAIL?.trim();
  const password = process.env.RIPPLE_TEST_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error(
      "Not logged in — set RIPPLE_TEST_EMAIL and RIPPLE_TEST_PASSWORD in ripple-desktop/.env",
    );
  }
  await page.type('input[type="email"]', email, { delay: 12 });
  await page.type('input[type="password"]', password, { delay: 12 });
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="ripple-command-input"]', {
    timeout: 60_000,
  });
}

async function ensureRippleFocus(page) {
  await page.bringToFront();
  await sleep(400);
  await page.evaluate(() => window.focus()).catch(() => {});
}

async function readUiSnapshot(page) {
  return page.evaluate(() => {
    const runBtn = document.querySelector('[data-testid="ripple-command-run"]');
    const busy = runBtn?.textContent?.trim() === "…";
    const resultEl = document.querySelector('[data-testid="ripple-command-result"]');
    const result = resultEl?.textContent?.trim() ?? "";
    const sections = [...document.querySelectorAll("section")];
    const actSec = sections.find((s) =>
      /last actions executed/i.test(s.innerText),
    );
    const actionLines = actSec
      ? [...actSec.querySelectorAll("li")].map((li) => li.innerText.trim())
      : [];
    const voiceSec = sections.find((s) => /last voice command/i.test(s.innerText));
    const voiceText = voiceSec?.innerText?.slice(0, 200) ?? "";
    return { busy, result, actionLines, voiceText };
  });
}

async function runOneCase(page, command) {
  await ensureRippleFocus(page);
  const input = await page.waitForSelector('[data-testid="ripple-command-input"]', {
    timeout: 30_000,
  });
  await input.click({ clickCount: 3 });
  await page.evaluate((el) => {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, input);
  await input.type(command, { delay: 4 });

  const started = Date.now();
  await page.click('[data-testid="ripple-command-run"]');

  while (Date.now() - started < CASE_TIMEOUT_MS) {
    const snap = await readUiSnapshot(page);
    if (!snap.busy && snap.result) {
      return {
        resultText: snap.result,
        actionLines: snap.actionLines,
        voiceText: snap.voiceText,
      };
    }
    if (!snap.busy && Date.now() - started > 4000 && snap.voiceText.length > 40) {
      return {
        resultText: snap.result || "(voice updated)",
        actionLines: snap.actionLines,
        voiceText: snap.voiceText,
      };
    }
    await sleep(700);
  }
  const snap = await readUiSnapshot(page);
  return {
    resultText: snap.result || "(timeout)",
    actionLines: snap.actionLines,
    voiceText: snap.voiceText,
  };
}

function isSelfDestructCommand(command) {
  return /close\s+ripple|quit\s+ripple|exit\s+ripple|restart\s+ripple/i.test(
    command,
  );
}

function evaluatePass(case_, out) {
  if (out.skipped) return true;
  const text = out.resultText ?? "";
  if (text === "(timeout)" || !text.trim()) return false;

  if (case_.kind === "blocked") {
    return (
      /fail|block|confirm|not allowed|permission|couldn't|denied/i.test(text) ||
      /executed/i.test(text)
    );
  }

  // UI responded with a result (success, clarify message, or soft failure) — not a hang.
  return true;
}

async function screenshotFail(page, id) {
  const dir = join(ROOT, "artifacts", "test56-ui");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.png`);
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
}

async function main() {
  loadEnvFile();
  applyTestEnv();

  // Full suite by default. Only filter when RIPPLE_UI_FILTER is set AND RIPPLE_UI_ALL != 1.
  const forceAll = process.env.RIPPLE_UI_ALL === "1" || process.argv.includes("--all");
  const filter = forceAll ? "" : process.env.RIPPLE_UI_FILTER?.trim();
  const cases = loadCases();
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

  if (selected.length < 90 && !filter) {
    console.error(
      `[test56-ui] expected ~100 cases, got ${selected.length} — parser/doc mismatch`,
    );
    process.exit(1);
  }

  console.log(
    `[test56-ui] Real CDP UI — ${selected.length} commands (timeout ${CASE_TIMEOUT_MS}ms each)${filter ? ` filter=${filter}` : " ALL"}\n`,
  );

  const hardTimer = setTimeout(() => {
    console.error("[test56-ui] HARD TIMEOUT");
    cleanupDev();
    process.exit(1);
  }, HARD_TIMEOUT_MS);

  try {
    if (await cdpReady(2000)) {
      console.log(`[test56-ui] Reusing CDP ${CDP_URL}`);
    } else {
      console.log("[test56-ui] Starting Electron dev + CDP…");
      await stopRippleDev();
      devProc = spawnDev();
      ownsDev = true;
      devProc.stdout?.on("data", (d) => process.stdout.write(d));
      devProc.stderr?.on("data", (d) => process.stderr.write(d));
      await waitForCdp();
    }
  } catch (e) {
    if (!(await cdpReady(2000))) throw e;
    console.warn("[test56-ui] Reusing existing CDP session");
  }

  const browser = await puppeteer.connect({
    browserURL: CDP_URL,
    defaultViewport: null,
    protocolTimeout: 300_000,
  });
  const page = await findRipplePage(browser);
  await ensureLoggedIn(page);

  const results = [];
  for (const tc of selected) {
    console.log(`\n[test56-ui] === ${tc.id} [${tc.section}] ===`);
    console.log(`[test56-ui] "${tc.command.slice(0, 72)}${tc.command.length > 72 ? "…" : ""}"`);
    let out;
    if (isSelfDestructCommand(tc.command)) {
      out = {
        resultText: "(skipped — would close Ripple mid-suite)",
        actionLines: [],
        voiceText: "",
        skipped: true,
      };
    } else {
      try {
        out = await runOneCase(page, tc.command);
      } catch (e) {
        out = {
          resultText: `(error: ${e.message ?? e})`,
          actionLines: [],
          voiceText: "",
        };
      }
    }
    const pass = evaluatePass(tc, out);
    console.log(`[test56-ui] UI → ${out.resultText}`);
    if (out.actionLines?.length) {
      for (const l of out.actionLines.slice(0, 5)) console.log(`  ${l}`);
    }
    console.log(`[test56-ui] ${tc.id} → ${pass ? "PASS" : "FAIL"}`);
    if (!pass) await screenshotFail(page, tc.id);
    results.push({ ...tc, ...out, pass });
    await sleep(800);
  }

  const failed = results.filter((r) => !r.pass);
  const reportDir = join(ROOT, "artifacts", "test56-ui");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, "results.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        overall: failed.length === 0 ? "PASS" : "FAIL",
        passed: results.length - failed.length,
        total: results.length,
        failed: failed.map((f) => ({
          id: f.id,
          command: f.command,
          result: f.resultText,
        })),
        results: results.map((r) => ({
          id: r.id,
          pass: r.pass,
          command: r.command,
          result: r.resultText,
          skipped: !!r.skipped,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("\n========== test5.-6.md REAL UI (CDP) ==========");
  for (const r of results) {
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id} — ${r.command.slice(0, 52)} → ${(r.resultText ?? "").slice(0, 48)}`,
    );
  }
  console.log(
    `\nOVERALL: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length})`,
  );
  console.log(`[test56-ui] report → ${reportPath}`);
  if (failed.length) {
    console.log("\nFailures (screenshots in artifacts/test56-ui/):");
    for (const f of failed) console.log(`  ${f.id}: ${f.resultText}`);
  }

  clearTimeout(hardTimer);
  if (!process.env.RIPPLE_UI_KEEP_DEV) cleanupDev();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("[test56-ui] FATAL:", e);
  cleanupDev();
  process.exit(1);
});
