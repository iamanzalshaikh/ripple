import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRippleDataDir } from "../config/ripplePaths.js";

/**
 * Crash visibility (desktop.md pass 1).
 *
 * Everything here writes SYNCHRONOUSLY. An abrupt process death (uncaught
 * exception, native crash, app.exit) does not flush async streams — the live
 * symptom was a dev-console log that stopped mid-word with no trace at all.
 * appendFileSync survives that; a WriteStream does not.
 *
 * This module must never throw: a failure inside the crash logger would hide
 * the very crash it exists to record.
 */

let crashDirCache: string | null = null;

function crashDir(): string {
  if (crashDirCache) return crashDirCache;
  const dir = join(getRippleDataDir(), "logs");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  crashDirCache = dir;
  return dir;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}`;
  }
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Append one line to the rolling breadcrumb file. Cheap enough to call on
 * lifecycle events so a crash log can be correlated with what happened just
 * before the process died.
 */
export function crashBreadcrumb(event: string, detail?: string): void {
  try {
    const line = `${new Date().toISOString()} ${event}${detail ? ` ${detail}` : ""}\n`;
    appendFileSync(join(crashDir(), "lifecycle.log"), line, "utf8");
  } catch {
    /* never throw from the logger */
  }
}

/** Write a full crash report file and mirror a summary to the console. */
export function writeCrashLog(
  kind: string,
  err: unknown,
  extra?: Record<string, unknown>,
): string | null {
  let file: string | null = null;
  try {
    file = join(crashDir(), `crash-${stamp()}.log`);
    const body = [
      `kind=${kind}`,
      `time=${new Date().toISOString()}`,
      `pid=${process.pid}`,
      `platform=${process.platform}`,
      `electron=${process.versions.electron ?? "?"}`,
      `node=${process.versions.node ?? "?"}`,
      `uptimeSec=${process.uptime().toFixed(1)}`,
      extra ? `extra=${JSON.stringify(extra)}` : null,
      "",
      describe(err),
      "",
    ]
      .filter((l) => l !== null)
      .join("\n");
    writeFileSync(file, body, "utf8");
    crashBreadcrumb(`CRASH kind=${kind}`, `file=${file}`);
  } catch {
    /* never throw from the logger */
  }
  try {
    console.error(
      `[ripple-crash] kind=${kind} logged=${file ?? "FAILED"}\n${describe(err)}`,
    );
  } catch {
    /* ignore */
  }
  return file;
}

let installed = false;

/**
 * Install main-process crash handlers. Call as early as possible in boot so a
 * crash during startup is still captured.
 *
 * Deliberately does NOT call app.quit()/exit: Electron's default for an
 * uncaught exception is to keep running, and force-quitting here would turn a
 * recoverable error into the very "app disappears" symptom we are debugging.
 */
export function installMainCrashHandlers(): void {
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (err, origin) => {
    writeCrashLog("main.uncaughtException", err, { origin });
  });

  process.on("unhandledRejection", (reason) => {
    writeCrashLog("main.unhandledRejection", reason);
  });

  // Node emits this when a warning is raised; useful for MaxListeners leaks
  // that precede a crash. Breadcrumb only — not a crash by itself.
  process.on("warning", (warning) => {
    crashBreadcrumb(
      "node_warning",
      `${warning.name}: ${warning.message.slice(0, 200)}`,
    );
  });

  process.on("exit", (code) => {
    crashBreadcrumb("process_exit", `code=${code}`);
  });

  crashBreadcrumb("crash_handlers_installed", `pid=${process.pid}`);
}

/** Path to the crash-log directory (surfaced in logs so the user can find it). */
export function getCrashLogDir(): string {
  return crashDir();
}
