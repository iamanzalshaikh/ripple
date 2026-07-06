/**
 * UI automation: E4/E7 command matrix via Ripple Home.
 * Usage: node scripts/ui-test-e4-e7-matrix.mjs
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CDP_PORT = Number(process.env.RIPPLE_UI_CDP_PORT ?? "9333");
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const HARD_TIMEOUT_MS = 1_200_000;

/** command, min succeeded actions, must not contain failed action substring */
const CASES = [
  { id: "E1", command: "type hello ripple matrix", minOk: 1 },
  { id: "E2", command: "open notepad", minOk: 1 },
  { id: "E3", command: "open notepad and type hello matrix", minOk: 2 },
  // E4 — paint + draw (sample across shapes)
  { id: "E4-01", command: "open paint and draw a circle", minOk: 3 },
  { id: "E4-02", command: "open paint and draw rectangle", minOk: 3 },
  { id: "E4-03", command: "open paint and type draw circle", minOk: 3 },
  { id: "E4-04", command: "open paint then draw line", minOk: 3 },
  { id: "E4-05", command: "launch paint and draw triangle", minOk: 3 },
  { id: "E4-06", command: "open paint and sketch shape", minOk: 3 },
  { id: "E4-07", command: "open paint and draw oval", minOk: 3 },
  { id: "E4-08", command: "open paint and draw a square", minOk: 3 },
  { id: "E4-09", command: "open paint and draw a star", minOk: 3 },
  { id: "E4-10", command: "open paint and draw a heart", minOk: 3 },
  { id: "E4-11", command: "open paint and draw", minOk: 3 },
  { id: "E4-12", command: "open paint and create drawing of circle", minOk: 3 },
  { id: "E4-13", command: "open paint and draw a circle then draw a square", minOk: 5 },
  // E7 — clipboard atomics (notepad context for selection)
  { id: "E7-01", command: "open notepad and type clip matrix test and copy this text", minOk: 3 },
  { id: "E7-02", command: "open notepad and type cut matrix test and cut selected content", minOk: 3 },
  { id: "E7-03", command: "copy ui paste matrix seed to clipboard and open notepad and paste clipboard content", minOk: 3 },
  { id: "E7-04", command: "open notepad and type select all matrix and select all and copy text", minOk: 4 },
  { id: "E7-05", command: "read clipboard", minOk: 1 },
  { id: "E7-06", command: "copy matrix ui test to clipboard", minOk: 1 },
  // E7 — save / create (notepad context)
  { id: "E7-07", command: "open notepad and type save matrix test and save file test.txt", minOk: 3 },
  { id: "E7-08", command: "open notepad and type create matrix test and create file data.txt", minOk: 3 },
  { id: "E7-09", command: "open notepad and type notes matrix test and save current file as notes.txt", minOk: 3 },
  { id: "E7-10", command: "open notepad and type called notes test and create a file called notes", minOk: 3 },
  // E7 — clipboard + save compounds
  { id: "E7-11", command: "open notepad and type compound copy test and copy this text and save file test.txt", minOk: 4 },
  { id: "E7-12", command: "open notepad and type compound cut test and cut and save file test.txt", minOk: 4 },
  { id: "E7-13", command: "open notepad and type compound select test and select all and copy then save as notes.txt", minOk: 5 },
  { id: "E7-14", command: "open notepad and type compound edge test and copy and save file test.txt", minOk: 4 },
  // Legacy save smoke (needs foreground app)
  { id: "save-01", command: "open chrome and save file ripple-ui-matrix-save.txt", minOk: 2 },
  { id: "save-02", command: "type matrix save test and save file ripple-ui-matrix-notes.txt", minOk: 2 },
];

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

function killPaint() {
  try {
    execSync("taskkill /IM mspaint.exe /F", { stdio: "ignore" });
  } catch {
    /* not running */
  }
}

function killNotepad() {
  try {
    execSync("taskkill /IM notepad.exe /F", { stdio: "ignore" });
  } catch {
    /* not running */
  }
}

async function ensureRippleFocus(page) {
  killPaint();
  await page.bringToFront();
  await sleep(600);
  await page.evaluate(() => window.focus()).catch(() => {});
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

async function waitForCdp(timeoutMs = 90_000) {
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
      env: {
        ...process.env,
        RIPPLE_P85_PHASE_B: "1",
        RIPPLE_P85_PLANNER_V2: "all",
        RIPPLE_P85_TRACE: "1",
      },
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
      if (/ripple/i.test(text)) {
        console.log(`[ui-matrix] Ready page: ${url}`);
        return page;
      }
    }
    await sleep(500);
  }
  if (candidate) return candidate;
  throw new Error("Ripple page not found");
}

async function ensureLoggedIn(page) {
  await page.waitForFunction(
    () =>
      /type command/i.test(document.body.innerText) ||
      /sign in/i.test(document.body.innerText),
    { timeout: 60_000 },
  );
  if (await page.evaluate(() => /type command/i.test(document.body.innerText))) {
    return;
  }
  const email = process.env.RIPPLE_TEST_EMAIL?.trim();
  const password = process.env.RIPPLE_TEST_PASSWORD?.trim();
  if (!email || !password) throw new Error("Need RIPPLE_TEST_EMAIL/PASSWORD in .env");
  await page.type('input[type="email"]', email, { delay: 10 });
  await page.type('input[type="password"]', password, { delay: 10 });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => /type command/i.test(document.body.innerText), {
    timeout: 45_000,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runOneCommand(page, command) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await ensureRippleFocus(page);
      const input = await page.waitForSelector('input[placeholder*="Download kholo"]', {
        timeout: 30_000,
      });
      await input.click({ clickCount: 3 });
      await page.evaluate((el) => {
        el.value = "";
      }, input);
      await input.type(command, { delay: 3 });

      const started = Date.now();
      await page.evaluate(() => {
        const run = [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Run",
        );
        run?.click();
      });

      while (Date.now() - started < 90_000) {
        const snap = await page.evaluate(() => {
          const sections = [...document.querySelectorAll("section")];
          const cmdSec = sections.find((s) => /type command/i.test(s.innerText));
          const result =
            cmdSec?.querySelector("p.text-xs")?.textContent?.trim() ?? "";
          const actSec = sections.find((s) =>
            /last actions executed/i.test(s.innerText),
          );
          const actionLines = actSec
            ? [...actSec.querySelectorAll("li")].map((li) => li.innerText.trim())
            : [];
          return { result, actionLines };
        });
        if (/executed|command failed|couldn't/i.test(snap.result)) {
          const ok = snap.actionLines.filter((l) => /✓|success|done/i.test(l)).length;
          const fail = snap.actionLines.filter((l) => /fail|error/i.test(l)).length;
          if (/open paint/i.test(command)) killPaint();
          if (/open notepad/i.test(command)) killNotepad();
          return {
            resultText: snap.result,
            actionLines: snap.actionLines,
            okCount: ok || (snap.result.toLowerCase().includes("executed") ? 1 : 0),
            failCount: fail,
          };
        }
        await sleep(1000);
      }
      return { resultText: "(timeout)", actionLines: [], okCount: 0, failCount: 1 };
    } catch (err) {
      lastError = err;
      console.warn(
        `[ui-matrix] attempt ${attempt}/${maxAttempts} failed: ${err?.message ?? err}`,
      );
      killPaint();
      killNotepad();
      await sleep(1500);
    }
  }

  throw lastError ?? new Error("runOneCommand failed");
}

async function main() {
  loadEnvFile();
  const hardTimer = setTimeout(() => {
    console.error("[ui-matrix] HARD TIMEOUT");
    cleanupDev();
    process.exit(1);
  }, HARD_TIMEOUT_MS);

  try {
    if (await cdpReady(2000)) {
      console.log(`[ui-matrix] Reusing CDP at ${CDP_URL}`);
    } else {
      console.log(`[ui-matrix] Starting dev (CDP ${CDP_PORT})…`);
      devProc = spawnDev();
      ownsDev = true;
      devProc.stdout?.on("data", (d) => process.stdout.write(d));
      devProc.stderr?.on("data", (d) => process.stderr.write(d));
      await waitForCdp();
    }
  } catch (e) {
    if (!(await cdpReady(2000))) throw e;
    console.warn("[ui-matrix] Spawn failed — reusing CDP");
  }

  const browser = await puppeteer.connect({
    browserURL: CDP_URL,
    defaultViewport: null,
    protocolTimeout: 300_000,
  });
  const page = await findRipplePage(browser);
  await ensureRippleFocus(page);
  await ensureLoggedIn(page);

  const filter = process.env.RIPPLE_UI_FILTER?.trim();
  const cases = filter
    ? CASES.filter((c) => c.id === filter || c.id.startsWith(filter))
    : CASES;

  const results = [];
  for (const c of cases) {
    console.log(`\n[ui-matrix] === ${c.id}: ${c.command} ===`);
    let out;
    try {
      out = await runOneCommand(page, c.command);
    } catch (err) {
      out = {
        resultText: `(error: ${err?.message ?? err})`,
        actionLines: [],
        okCount: 0,
        failCount: 1,
      };
    }
    const pass =
      !/command failed|couldn't/i.test(out.resultText) &&
      out.failCount === 0 &&
      (out.actionLines.length === 0
        ? /executed/i.test(out.resultText)
        : out.okCount >= c.minOk);
    console.log(`[ui-matrix] ${c.id} → ${out.resultText}`);
    if (out.actionLines.length) {
      for (const l of out.actionLines) console.log(`  ${l}`);
    }
    results.push({ ...c, ...out, pass });
    await sleep(2500);
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n========== UI MATRIX ==========");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id}: ${r.command}`);
  }
  console.log(`\nVERDICT: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length}/${results.length})`);
  console.log("===============================\n");

  clearTimeout(hardTimer);
  if (!process.env.RIPPLE_UI_KEEP_DEV) cleanupDev();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[ui-matrix] FATAL:", e);
  cleanupDev();
  process.exit(1);
});
