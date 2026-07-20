/**
 * Wave 0 production trust suite — Playwright UI automation.
 *
 * Drives the REAL Ripple Electron process via the OS test file bridge
 * (electron/osTestBridge.ts). Same production path as spoken commands:
 * command → planner → executor → Windows filesystem.
 *
 * Prerequisites:
 *   1. Ripple running: `npm run dev` (bridge auto-starts in unpackaged builds)
 *   2. Env: RIPPLE_P85_PLANNER_V2=all (set by electron-vite / .env)
 *
 * Run:
 *   npx playwright test tests/wave0.spec.ts --ui
 *   npx playwright test tests/wave0.spec.ts --project=wave0
 */
import { test, expect } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  DESKTOP,
  REPORTS,
  SOURCE,
  W0,
  W0_ROOT,
  mustExist,
  mustFail,
  mustNotExist,
  mustNotTool,
  mustOk,
  mustTool,
  requireBridge,
  sendViaBridge,
} from "./helpers/osBridge";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await requireBridge(30_000);
  rmSync(W0_ROOT, { recursive: true, force: true });
  mkdirSync(W0_ROOT, { recursive: true });
});

test.afterAll(async () => {
  rmSync(W0_ROOT, { recursive: true, force: true });
  for (const stray of [
    "Archive",
    "TestFolder",
    "Moved",
    "FileDest",
    "Backups",
  ]) {
    rmSync(join(DESKTOP, stray), { recursive: true, force: true });
  }
});

test("T1 — Create root folder on C drive", async () => {
  const b = await sendViaBridge(
    "Create a folder called Ripple-Test on C drive",
  );
  mustOk(b);
  mustExist(W0_ROOT);
});

test("T2 — Create W0 folder inside Ripple-Test", async () => {
  const b = await sendViaBridge(
    "Create a folder called W0 inside C:\\Ripple-Test",
  );
  mustOk(b);
  mustExist(W0);
});

test("T3 — Create Source folder inside W0", async () => {
  const b = await sendViaBridge(
    "Create a folder called Source inside C:\\Ripple-Test\\W0",
  );
  mustOk(b);
  mustExist(SOURCE);
});

test("T4 — Create Reports folder inside Source", async () => {
  const b = await sendViaBridge(
    "Create a folder called Reports inside C:\\Ripple-Test\\W0\\Source",
  );
  mustOk(b);
  mustExist(REPORTS);
});

test("T5 — Create nested Q1 folder inside Reports", async () => {
  const b = await sendViaBridge(
    "Create a folder called Q1 inside C:\\Ripple-Test\\W0\\Source\\Reports",
  );
  mustOk(b);
  mustExist(join(REPORTS, "Q1"));
});

test("T6a — Create sales.txt inside Q1 (absolute path)", async () => {
  const b = await sendViaBridge(
    "Create a file called sales.txt inside C:\\Ripple-Test\\W0\\Source\\Reports\\Q1",
  );
  mustOk(b);
  mustNotTool(b, "desktop.save_file");
  mustExist(join(REPORTS, "Q1", "sales.txt"));
});

test("T6b — Create report1.txt inside Reports", async () => {
  const b = await sendViaBridge(
    "Create a file called report1.txt inside C:\\Ripple-Test\\W0\\Source\\Reports",
  );
  mustOk(b);
  mustNotTool(b, "desktop.save_file");
  mustExist(join(REPORTS, "report1.txt"));
});

test("T6c — Create report2.txt inside Reports", async () => {
  const b = await sendViaBridge(
    "Create a file called report2.txt inside C:\\Ripple-Test\\W0\\Source\\Reports",
  );
  mustOk(b);
  mustExist(join(REPORTS, "report2.txt"));
});

test("T6d — Create notes.txt inside Desktop (spoken location, not save_file)", async () => {
  const target = join(DESKTOP, "ripple-w0-notes.txt");
  if (existsSync(target)) rmSync(target, { force: true });

  const b = await sendViaBridge(
    "Create a file called ripple-w0-notes.txt inside Desktop",
  );
  mustOk(b);
  mustNotTool(b, "desktop.save_file");
  mustExist(target);
  rmSync(target, { force: true });
});

test("T7 — Spoken path resolution finds Reports", async () => {
  const b = await sendViaBridge("Find Reports folder");
  mustOk(b);
  if (
    /desktop/i.test(b.message ?? "") &&
    !/Ripple-Test/i.test(b.message ?? "")
  ) {
    throw new Error(`resolved via Desktop fallback: ${b.message}`);
  }
});

test("T8 — Copy folder to a new folder called Archive", async () => {
  const b = await sendViaBridge(
    `Copy the folder ${REPORTS} to a new folder called Archive`,
  );
  mustTool(b, "filesystem.copy_folder");
  mustOk(b);
  const archive = join(SOURCE, "Archive");
  mustExist(archive);
  mustExist(join(archive, "report1.txt"));
  mustExist(join(archive, "Q1", "sales.txt"));
  mustNotExist(join(archive, "Reports"));
  mustNotExist(join(DESKTOP, "Archive"));
});

test("T9 — Copy folder into existing destination nests as child", async () => {
  const destination = join(W0, "Destination");
  mkdirSync(destination, { recursive: true });
  const b = await sendViaBridge(
    `Copy the folder ${REPORTS} to ${destination}`,
  );
  mustTool(b, "filesystem.copy_folder");
  mustOk(b);
  mustExist(join(destination, "Reports", "report1.txt"));
});

test("T10 — Bare unknown dest must not collapse to Desktop", async () => {
  const b = await sendViaBridge(
    `Copy the folder ${REPORTS} to TestFolder`,
  );
  mustTool(b, "filesystem.copy_folder");
  mustOk(b);
  mustNotExist(join(DESKTOP, "TestFolder"));
  mustExist(join(SOURCE, "TestFolder", "report1.txt"));
});

test("T11 — Compare folders (compound gate must not intercept)", async () => {
  const compareA = join(W0, "CompareA");
  const compareB = join(W0, "CompareB");
  mkdirSync(compareA, { recursive: true });
  mkdirSync(compareB, { recursive: true });
  writeFileSync(join(compareA, "same.txt"), "same");
  writeFileSync(join(compareB, "same.txt"), "same");

  const b = await sendViaBridge(
    `Compare these two folders ${compareA} and ${compareB}`,
  );
  mustTool(b, "filesystem.compare_directories");
  mustOk(b);
});

test("T12a — Admin routing: Notepad", async () => {
  const b = await sendViaBridge("Run Notepad as administrator");
  mustTool(b, "os.run_as_admin");
  mustNotTool(b, "automation.run_command");
  // UAC prompt may block ok=true on some machines; routing is the Wave 0 gate.
  expect(b.tools).toContain("os.run_as_admin");
});

test("T12b — Admin routing: Terminal", async () => {
  const b = await sendViaBridge("Open terminal as administrator");
  mustTool(b, "os.run_as_admin");
  mustNotTool(b, "automation.run_command");
});

test("T13 — ipconfig still routes to automation.run_command", async () => {
  const b = await sendViaBridge("Run ipconfig");
  mustTool(b, "automation.run_command");
  mustOk(b);
});

test("T14 — Nonexistent source must FAIL (no fake SUCCESS)", async () => {
  const b = await sendViaBridge(
    `Copy the folder ${join(SOURCE, "DoesNotExist")} to Archive2`,
  );
  mustFail(b);
});

test("T15 — Duplicate dispatch dedupes to one execution", async () => {
  mkdirSync(join(W0, "Backup"), { recursive: true });
  const cmd = `Copy the file ${join(REPORTS, "report1.txt")} to ${join(W0, "Backup")}`;
  const [first, second] = await Promise.all([
    sendViaBridge(cmd).catch((e: Error) => ({
      ok: false,
      message: e.message,
      id: "err",
    })),
    sendViaBridge(cmd).catch((e: Error) => ({
      ok: false,
      message: e.message,
      id: "err",
    })),
  ]);
  const successes = [first, second].filter((r) => r.ok).length;
  expect(successes).toBeLessThanOrEqual(1);
});

test("T16 — Clarify recovery: new command runs independently", async () => {
  await sendViaBridge("Compare these two folders").catch(() => {});
  const b = await sendViaBridge("Run ipconfig");
  mustTool(b, "automation.run_command");
  mustOk(b);
});

test("T18 — Undo removes the folder just copied", async () => {
  const undoTarget = join(SOURCE, "UndoMe");
  await sendViaBridge(
    `Copy the folder ${REPORTS} to a new folder called UndoMe`,
  );
  const b = await sendViaBridge("Undo last copy");
  mustOk(b);
  mustNotExist(undoTarget);
});

test("T19 — Bulk delete requires confirmation (never silent)", async () => {
  const b = await sendViaBridge(`Delete the folder ${W0_ROOT}`);
  if (b.ok && !/confirm|sure|are you/i.test(b.message ?? "")) {
    throw new Error(
      `bulk delete executed without any confirmation gate: ${b.message}`,
    );
  }
});

test("E4 — Admin alias: PowerShell", async () => {
  const b = await sendViaBridge("Run PowerShell as administrator");
  mustTool(b, "os.run_as_admin");
  mustNotTool(b, "automation.run_command");
});

test("E10 — Case variant: open notepad as admin", async () => {
  const b = await sendViaBridge("open notepad as admin");
  mustTool(b, "os.run_as_admin");
  mustNotTool(b, "automation.run_command");
});
