/**
 * File-bridge helpers for Wave 0 Playwright E2E.
 * Same path as scripts/ui-test-wave0.mjs — real Ripple planner → executor → disk.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RIPPLE_DIR = join(homedir(), "AppData", "Roaming", "ripple-desktop");
export const IN_FILE = join(RIPPLE_DIR, "os-test-in.json");
export const OUT_FILE = join(RIPPLE_DIR, "os-test-out.json");
export const BRIDGE_PING = "__ripple_os_bridge_ping__";

export const W0_ROOT = "C:\\Ripple-Test";
export const W0 = join(W0_ROOT, "W0");
export const SOURCE = join(W0, "Source");
export const REPORTS = join(SOURCE, "Reports");
export const DESKTOP = join(homedir(), "Desktop");

export type BridgeResult = {
  id: string;
  ok: boolean;
  message?: string;
  tools?: string;
  toolsList?: string[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function sendViaBridge(
  command: string,
  timeoutMs = 100_000,
): Promise<BridgeResult> {
  if (!existsSync(RIPPLE_DIR)) mkdirSync(RIPPLE_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) unlinkSync(OUT_FILE);
  const id = `pw-w0-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  writeFileSync(IN_FILE, JSON.stringify({ id, command }), "utf8");

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(OUT_FILE)) {
      const out = JSON.parse(readFileSync(OUT_FILE, "utf8")) as BridgeResult;
      if (out.id === id) return out;
    }
    await sleep(300);
  }
  throw new Error(`bridge timeout waiting for: ${command}`);
}

export async function requireBridge(timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  let lastErr: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const out = await sendViaBridge(BRIDGE_PING, 8_000);
      if (out.ok !== undefined) return;
    } catch (e) {
      lastErr = e;
    }
    await sleep(500);
  }
  throw new Error(
    `Ripple OS test bridge not ready. Start Electron with \`npm run dev\` (or keep Playwright UI open against a running Ripple). Last error: ${lastErr}`,
  );
}

export function mustExist(path: string) {
  if (!existsSync(path)) throw new Error(`expected to exist: ${path}`);
}

export function mustNotExist(path: string) {
  if (existsSync(path)) throw new Error(`expected NOT to exist: ${path}`);
}

export function mustOk(bridge: BridgeResult) {
  if (!bridge.ok) {
    throw new Error(`expected ok=true, got ok=false: ${bridge.message}`);
  }
}

export function mustFail(bridge: BridgeResult) {
  if (bridge.ok) {
    throw new Error(`expected ok=false (this should fail), got ok=true`);
  }
}

export function mustTool(bridge: BridgeResult, tool: string) {
  if (!bridge.tools?.includes(tool)) {
    throw new Error(`expected tool "${tool}", got "${bridge.tools}"`);
  }
}

export function mustNotTool(bridge: BridgeResult, tool: string) {
  if (bridge.tools?.includes(tool)) {
    throw new Error(`must NOT route to "${tool}", got "${bridge.tools}"`);
  }
}
