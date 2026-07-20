import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { clearUndoStack } from "./automation/safety/undoStack.js";
import { setConfirmHandlerForTests } from "./automation/safety/executionGuard.js";

export type OsTestIn = {
  id: string;
  command: string;
};

export type OsTestOut = {
  id: string;
  ok: boolean;
  message?: string;
  actionsOk?: number;
  actionsTotal?: number;
  planSteps?: number;
  dragSteps?: number;
  tools?: string;
  toolsList?: string[];
  plannerKind?: string;
  intent?: string;
  blocked?: boolean;
};

function bridgeDir(): string {
  const dir = join(app.getPath("userData"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function osTestInPath(): string {
  return join(bridgeDir(), "os-test-in.json");
}

export function osTestOutPath(): string {
  return join(bridgeDir(), "os-test-out.json");
}

/** Dev-only file bridge so OS tests can run commands without CDP. */
export type OsTestBridgeResult = {
  ok: boolean;
  message?: string;
  actionsOk?: number;
  actionsTotal?: number;
  dragSteps?: number;
  tools?: string;
  toolsList?: string[];
  plannerKind?: string;
  intent?: string;
  blocked?: boolean;
};

export function startOsTestBridge(
  run: (command: string) => Promise<OsTestBridgeResult>,
): void {
  if (app.isPackaged && process.env.RIPPLE_OS_TEST !== "1") return;

  const inPath = osTestInPath();
  const outPath = osTestOutPath();
  let busy = false;

  // Wave 0 / Playwright bridge: never hang on Confirm/Cancel dialogs or UAC.
  // Production voice still shows dialogs; only the file bridge auto-approves.
  process.env.RIPPLE_OS_TEST = "1";
  setConfirmHandlerForTests(async () => true);
  clearUndoStack();

  console.info(`[ripple-os-test] bridge active → ${inPath}`);

  setInterval(async () => {
    if (busy || !existsSync(inPath)) return;
    busy = true;
    let payload: OsTestIn | null = null;
    try {
      payload = JSON.parse(readFileSync(inPath, "utf8")) as OsTestIn;
      unlinkSync(inPath);
      if (payload.command === "__ripple_os_bridge_clear_undo__") {
        clearUndoStack();
        writeFileSync(
          outPath,
          JSON.stringify({
            id: payload.id,
            ok: true,
            message: "undo_cleared",
          }),
          "utf8",
        );
        return;
      }
      const result = await Promise.race([
        run(payload.command),
        new Promise<OsTestBridgeResult>((_, reject) =>
          setTimeout(
            () => reject(new Error("os_test_bridge_command_timeout")),
            90_000,
          ),
        ),
      ]);
      const out: OsTestOut = {
        id: payload.id,
        ok: result.ok,
        message: result.message,
        actionsOk: result.actionsOk,
        actionsTotal: result.actionsTotal,
        dragSteps: result.dragSteps,
        tools: result.tools,
        toolsList: result.toolsList,
        plannerKind: result.plannerKind,
        intent: result.intent,
        blocked: result.blocked,
      };
      writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    } catch (e: unknown) {
      const out: OsTestOut = {
        id: payload?.id ?? "unknown",
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
      writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
      try {
        if (existsSync(inPath)) unlinkSync(inPath);
      } catch {
        /* ignore */
      }
    } finally {
      busy = false;
    }
  }, 400);
}
