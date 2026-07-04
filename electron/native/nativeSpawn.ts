import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { getNativeSessionFilePath } from "../config/ripplePaths.js";
import type { NativeSessionInfo } from "./nativePipeFraming.js";
import {
  findRippleDesktopRoot,
  getBundledNativeExePath,
  getRippleDesktopRootCandidates,
} from "./nativePaths.js";
import {
  connectNativeClient,
  disconnectNativeClient,
  pingNativeSidecar,
} from "./nativeClient.js";

let child: ChildProcess | null = null;
let restartBackoffMs = 1000;
const MAX_BACKOFF_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTaskkill(args: string[]): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const p = spawn("taskkill", args, { windowsHide: true, stdio: "ignore" });
      p.once("error", () => resolve());
      p.once("exit", () => resolve());
    });
  } catch {
    /* ignore */
  }
}

function nativeExeCandidates(): string[] {
  const fromEnv = process.env.RIPPLE_NATIVE_EXE?.trim();
  const paths: string[] = [];

  if (fromEnv) paths.push(fromEnv);

  const bundled = getBundledNativeExePath();
  if (bundled) paths.push(bundled);

  const root = findRippleDesktopRoot();
  const roots = root ? [root, ...getRippleDesktopRootCandidates()] : getRippleDesktopRootCandidates();
  const seen = new Set<string>();

  for (const base of roots) {
    for (const rel of [
      join("ripple-native", "target", "release", "ripple-native.exe"),
      join("ripple-native", "target", "debug", "ripple-native.exe"),
    ]) {
      const full = join(base, rel);
      if (!seen.has(full)) {
        seen.add(full);
        paths.push(full);
      }
    }
  }

  return paths;
}

export function resolveNativeExePath(): string | null {
  for (const p of nativeExeCandidates()) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function readSessionFile(): NativeSessionInfo | null {
  const path = getNativeSessionFilePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as NativeSessionInfo;
    if (!parsed?.pipe || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearSessionFile(): void {
  const path = getNativeSessionFilePath();
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}

async function waitForSessionForPid(
  pid: number,
  timeoutMs = 10_000,
): Promise<NativeSessionInfo | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const session = readSessionFile();
    if (session && session.pid === pid) return session;
    await delay(100);
  }
  return null;
}

async function killOrphanSidecars(): Promise<void> {
  if (process.platform !== "win32") return;
  await runTaskkill(["/IM", "ripple-native.exe", "/F", "/T"]);
}

async function killChild(): Promise<void> {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      await runTaskkill(["/pid", String(child.pid), "/f", "/t"]);
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* ignore */
  }
  child = null;
}

export function getNativeChildPid(): number | null {
  return child?.pid ?? null;
}

export async function spawnNativeSidecar(): Promise<NativeSessionInfo | null> {
  if (process.platform !== "win32") return null;

  const exe = resolveNativeExePath();
  if (!exe) {
    const root = findRippleDesktopRoot();
    console.warn(
      `[ripple-native] sidecar binary not found (searched under ${root ?? "?"}) — run: npm run native:build`,
    );
    return null;
  }

  await killChild();
  await killOrphanSidecars();
  clearSessionFile();
  disconnectNativeClient();
  await delay(250);

  child = spawn(exe, [], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const spawnedPid = child.pid;
  if (!spawnedPid) {
    console.warn("[ripple-native] sidecar spawn returned no pid");
    return null;
  }

  child.stdout?.on("data", (buf: Buffer) => {
    const line = buf.toString("utf8").trim();
    if (line) console.info(`[ripple-native:stdout] ${line}`);
  });
  child.stderr?.on("data", (buf: Buffer) => {
    const line = buf.toString("utf8").trim();
    if (line) console.warn(`[ripple-native:stderr] ${line}`);
  });

  child.on("exit", (code, signal) => {
    console.warn(
      `[ripple-native] sidecar exited code=${code ?? "?"} signal=${signal ?? ""}`,
    );
    child = null;
    disconnectNativeClient();
  });

  const session = await waitForSessionForPid(spawnedPid);
  if (!session) {
    console.warn(
      `[ripple-native] session file not written for pid=${spawnedPid} in time`,
    );
    killChild();
    return null;
  }

  restartBackoffMs = 1000;
  console.info(`[ripple-native] sidecar spawned pid=${session.pid} exe=${exe}`);
  return session;
}

async function connectWithRetry(
  session: NativeSessionInfo,
  attempts = 5,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const connected = await connectNativeClient(session);
    if (connected && (await pingNativeSidecar())) return true;
    disconnectNativeClient();
    await delay(200 + i * 150);
  }
  return false;
}

export async function ensureNativeSidecar(): Promise<NativeSessionInfo | null> {
  const existing = readSessionFile();
  if (existing) {
    const connected = await connectWithRetry(existing, 2);
    if (connected) return existing;
    disconnectNativeClient();
    console.warn(
      `[ripple-native] stale session pid=${existing.pid} — respawning sidecar`,
    );
  }

  const session = await spawnNativeSidecar();
  if (!session) return null;

  const connected = await connectWithRetry(session);
  if (connected) return session;

  const fresh = readSessionFile();
  if (fresh && fresh.pid !== session.pid) {
    const retry = await connectWithRetry(fresh);
    if (retry) return fresh;
  }

  console.warn("[ripple-native] could not connect to sidecar pipe after spawn");
  return null;
}

export async function restartNativeSidecar(): Promise<NativeSessionInfo | null> {
  console.warn("[ripple-native] restarting sidecar...");
  await killChild();
  await killOrphanSidecars();
  clearSessionFile();
  disconnectNativeClient();
  await delay(restartBackoffMs);
  restartBackoffMs = Math.min(Math.round(restartBackoffMs * 1.5), MAX_BACKOFF_MS);
  return ensureNativeSidecar();
}

export function stopNativeSidecar(): void {
  void killChild();
  disconnectNativeClient();
}
