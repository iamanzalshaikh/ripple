/**
 * UI automation: compound Notepad save via Ripple Home command box.
 * Usage: node scripts/ui-test-compound-notepad-save.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CDP_PORT = Number(process.env.RIPPLE_UI_CDP_PORT ?? "9333");
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const HARD_TIMEOUT_MS = 130_000;
const TEST_FILENAME = `ripple-ui-save-${Date.now()}.txt`;
const TEST_PATH = join(homedir(), "Downloads", TEST_FILENAME);
const COMMAND = `open notepad and type hello ripple ui test and save as ${TEST_FILENAME} in downloads`;

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

async function ps(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-Command", command], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(out || `exit ${code}`));
      else resolve(out.trim());
    });
  });
}

/** Win11 Notepad uses 2 processes; only one owns the main window. */
async function countNotepadWindows() {
  try {
    const out = await ps(
      `(Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Measure-Object).Count`,
    );
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

async function closeAllNotepad() {
  try {
    await ps(
      `Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0`,
    );
  } catch {
    /* none */
  }
  await sleep(400);
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

async function findRipplePage(browser) {
  let candidate = null;
  for (let i = 0; i < 150; i++) {
    const pages = await browser.pages();
    if (i % 10 === 0 && pages.length) {
      console.log(
        `[ui-test] CDP pages (${pages.length}):`,
        pages.map((p) => p.url()).join(" | "),
      );
    }
    for (const page of pages) {
      const url = page.url();
      if (!/localhost:\d+/.test(url) || url.includes("overlay")) continue;
      candidate = page;
      const text = await page
        .evaluate(() => document.body?.innerText ?? "")
        .catch(() => "");
      if (text.includes("Loading Ripple")) break;
      if (/ripple/i.test(text)) {
        console.log(`[ui-test] Ready page: ${url}`);
        return page;
      }
    }
    await sleep(500);
  }
  if (candidate) {
    console.warn("[ui-test] Using candidate page after wait");
    return candidate;
  }
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

async function findSavedTestFile() {
  if (existsSync(TEST_PATH)) return TEST_PATH;
  const downloads = join(homedir(), "Downloads");
  const match = readdirSync(downloads)
    .filter((f) => f.startsWith("ripple-ui-save-") && f.endsWith(".txt"))
    .sort()
    .pop();
  return match ? join(downloads, match) : null;
}

async function waitForCommandOutcome(page, startedAt) {
  while (Date.now() - startedAt < HARD_TIMEOUT_MS - 15_000) {
    const found = await findSavedTestFile();
    if (found) {
      const content = readFileSync(found, "utf8");
      if (/hello ripple ui test/i.test(content)) {
        return {
          resultText: "Executed (file detected)",
          actionLines: [],
          savedPath: found,
        };
      }
    }
    const snap = await page.evaluate(() => {
      const body = document.body.innerText;
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
      return { result, actionLines, body: body.slice(0, 500) };
    });
    if (/executed|command failed/i.test(snap.result)) {
      return {
        resultText: snap.result,
        actionLines: snap.actionLines,
        savedPath: await findSavedTestFile(),
      };
    }
    await sleep(1200);
  }
  return { resultText: "", actionLines: [], savedPath: await findSavedTestFile() };
}

async function runCompoundSave(page) {
  const input = await page.waitForSelector('input[placeholder*="Download kholo"]', {
    timeout: 20_000,
  });
  await input.click({ clickCount: 3 });
  await page.evaluate((el) => {
    el.value = "";
  }, input);
  await input.type(COMMAND, { delay: 5 });

  const notepadBefore = await countNotepadWindows();
  console.log(`[ui-test] Notepad before: ${notepadBefore}`);

  const started = Date.now();
  await page.evaluate(() => {
    const run = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Run",
    );
    run?.click();
  });

  const { resultText, actionLines, savedPath } = await waitForCommandOutcome(
    page,
    started,
  );
  console.log(`[ui-test] UI result: ${resultText || "(none)"}`);
  if (actionLines.length) {
    console.log("[ui-test] Actions:");
    for (const l of actionLines) console.log(`  ${l}`);
  }

  await sleep(2000);
  const notepadAfter = await countNotepadWindows();
  console.log(`[ui-test] Notepad after: ${notepadAfter}`);
  return { resultText, actionLines, notepadBefore, notepadAfter, savedPath };
}

async function main() {
  loadEnvFile();
  const hardTimer = setTimeout(() => {
    console.error("[ui-test] HARD TIMEOUT — aborting");
    cleanupDev();
    process.exit(1);
  }, HARD_TIMEOUT_MS);

  if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH);
  try {
    const downloads = join(homedir(), "Downloads");
    for (const f of readdirSync(downloads)) {
      if (f.startsWith("ripple-ui-save-") && f.endsWith(".txt")) {
        unlinkSync(join(downloads, f));
      }
    }
  } catch {
    /* ignore */
  }
  await closeAllNotepad();

  try {
    if (await cdpReady(2000)) {
      console.log(`[ui-test] Reusing CDP at ${CDP_URL}`);
    } else {
      console.log(`[ui-test] Starting electron-vite dev (CDP ${CDP_PORT})…`);
      devProc = spawnDev();
      ownsDev = true;
      devProc.stdout?.on("data", (d) => process.stdout.write(d));
      devProc.stderr?.on("data", (d) => process.stderr.write(d));
      await waitForCdp();
    }
  } catch (e) {
    if (await cdpReady(2000)) {
      console.warn("[ui-test] Spawn failed — reusing existing CDP");
    } else {
      throw e;
    }
  }

  const browser = await puppeteer.connect({
    browserURL: CDP_URL,
    defaultViewport: null,
  });
  const page = await findRipplePage(browser);
  await page.bringToFront();
  await ensureLoggedIn(page);

  const { resultText, actionLines, notepadBefore, notepadAfter, savedPath } =
    await runCompoundSave(page);

  await page.screenshot({
    path: join(ROOT, "scripts", "ui-test-screenshot-after.png"),
    fullPage: true,
  });

  const filePath = savedPath ?? (await findSavedTestFile());
  const fileOk = Boolean(filePath && existsSync(filePath));
  const fileContent = fileOk ? readFileSync(filePath, "utf8") : "";
  const failedActions = actionLines.filter((l) => /fail/i.test(l));

  let pass = true;
  const issues = [];
  if (!fileOk) {
    pass = false;
    issues.push("File not saved to Downloads");
  } else if (!/hello ripple ui test/i.test(fileContent)) {
    pass = false;
    issues.push("Saved file missing expected text");
  }
  if (!/executed/i.test(resultText) && !fileOk) {
    pass = false;
    issues.push(`UI: ${resultText || "no result"}`);
  }
  if (failedActions.length) {
    pass = false;
    issues.push(`Failed actions: ${failedActions.join(" | ")}`);
  }
  if (notepadAfter > 1 || notepadAfter - notepadBefore > 1) {
    pass = false;
    issues.push(`Too many Notepad windows (${notepadBefore}→${notepadAfter})`);
  }

  console.log("\n========== UI TEST ==========");
  console.log(`VERDICT: ${pass ? "PASS" : "FAIL"}`);
  console.log(`File: ${fileOk ? filePath : "missing"}`);
  if (fileOk) console.log(`Content: ${fileContent.trim().slice(0, 60)}`);
  console.log(`Notepad: ${notepadBefore} → ${notepadAfter}`);
  if (issues.length) issues.forEach((i) => console.log(`  - ${i}`));
  console.log("=============================\n");

  clearTimeout(hardTimer);
  cleanupDev();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[ui-test] FATAL:", e);
  cleanupDev();
  process.exit(1);
});
