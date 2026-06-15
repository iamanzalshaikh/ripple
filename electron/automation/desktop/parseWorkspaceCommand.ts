import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import {
  resolveWorkspace,
  saveUserWorkspace,
  type WorkspaceEntry,
} from "./workspaceRegistry.js";

export type WorkspaceIntent =
  | { kind: "open_workspace"; workspace: WorkspaceEntry; spokenName: string }
  | { kind: "remember_workspace"; name: string; url: string };

export function parseWorkspaceMetaCommand(
  command?: string | null,
): WorkspaceIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  const remember = cmd.match(
    /^\s*remember\s+(?:my\s+)?(.+?)\s+(?:is|as)\s+(https?:\/\/.+?)\s*\.?\s*$/i,
  );
  if (remember?.[1] && remember[2]) {
    const url = remember[2].trim().replace(/\s+/g, "");
    if (/^https?:\/\//i.test(url)) {
      return {
        kind: "remember_workspace",
        name: remember[1].trim(),
        url,
      };
    }
  }

  return null;
}

/** "Open GitHub" / "Open my Ripple repo" (via alias) - URL launch only. */
export function parseWorkspaceOpenCommand(
  command?: string | null,
): WorkspaceIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  const openMatch = cmd.match(/^\s*open\s+(?:my\s+)?(.+?)\s*\.?\s*$/i);
  if (!openMatch?.[1]) return null;

  const spoken = openMatch[1].trim();
  const workspace = resolveWorkspace(spoken);
  if (!workspace) return null;

  return { kind: "open_workspace", workspace, spokenName: spoken };
}
