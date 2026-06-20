import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { hasTokens } from "../auth/tokenStore.js";
import { API_BASE } from "./api.js";
import { rippleSocket } from "../socket/rippleSocket.js";
import { listRegisteredHotkeys } from "../native/hotkeyRegistry.js";
import { getFileIndexCount } from "../storage/fileIndex.js";
import { lookupEntity } from "../storage/knowledgeGraph.js";

export type PreflightCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type PreflightReport = {
  ready: boolean;
  checks: PreflightCheck[];
};

export async function runPreflightHealth(
  pingBackend?: () => Promise<boolean>,
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];

  checks.push({
    id: "auth",
    ok: await hasTokens(),
    detail: (await hasTokens())
      ? "Signed in"
      : "Not signed in — log in before demo",
  });

  let backendOk = false;
  try {
    backendOk = pingBackend ? await pingBackend() : false;
  } catch {
    backendOk = false;
  }
  checks.push({
    id: "backend",
    ok: backendOk,
    detail: backendOk
      ? `Backend reachable (${API_BASE})`
      : `Backend not reachable at ${API_BASE}`,
  });

  checks.push({
    id: "socket",
    ok: rippleSocket.isConnected(),
    detail: rippleSocket.isConnected()
      ? "Socket connected — voice STT ready"
      : "Socket offline — voice may fail; text commands use REST",
  });

  const hotkeys = listRegisteredHotkeys();
  checks.push({
    id: "hotkey",
    ok: hotkeys.length > 0,
    detail:
      hotkeys.length > 0
        ? `Hotkeys: ${hotkeys.join(", ")}`
        : "No global hotkey registered",
  });

  const indexCount = getFileIndexCount();
  checks.push({
    id: "file_index",
    ok: indexCount > 0,
    detail:
      indexCount > 0
        ? `File index: ${indexCount} paths`
        : "File index empty — search may be slower on first commands",
  });

  const resumePath = join(homedir(), "Downloads", "resume.pdf");
  const hasResume =
    existsSync(resumePath) || Boolean(lookupEntity("my resume")?.path);
  checks.push({
    id: "resume",
    ok: hasResume,
    detail: hasResume
      ? "Resume demo file or alias ready"
      : "Put resume.pdf in Downloads for “open my resume” demo",
  });

  const ready = checks.filter((c) =>
    ["auth", "backend", "hotkey"].includes(c.id),
  ).every((c) => c.ok);

  return { ready, checks };
}
