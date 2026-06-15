import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import type { SystemActionId } from "./systemActions.js";

export type SystemActionIntent = {
  kind: "system_action";
  action: SystemActionId;
};

/**
 * Phase 4.4 — Windows system control (settings, lock, control panel).
 * Task Manager is handled via native app registry ("open task manager").
 */
export function parseSystemActionCommand(
  command?: string | null,
): SystemActionIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  if (
    /^\s*lock\s+(?:my\s+)?(?:pc|computer|screen|workstation|machine)\s*\.?\s*$/i.test(
      cmd,
    )
  ) {
    return { kind: "system_action", action: "lock_pc" };
  }

  if (
    /^\s*open\s+(?:the\s+)?bluetooth\s+settings?\s*\.?\s*$/i.test(cmd) ||
    /^\s*open\s+bluetooth\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "system_action", action: "open_bluetooth_settings" };
  }

  if (
    /^\s*open\s+(?:the\s+)?(?:network|wifi|wi-?fi)\s+settings?\s*\.?\s*$/i.test(
      cmd,
    ) ||
    /^\s*open\s+(?:network|wifi|wi-?fi)\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "system_action", action: "open_network_settings" };
  }

  if (/^\s*open\s+(?:the\s+)?control\s+panel\s*\.?\s*$/i.test(cmd)) {
    return { kind: "system_action", action: "open_control_panel" };
  }

  if (
    /^\s*open\s+(?:windows\s+)?settings?\s*\.?\s*$/i.test(cmd) ||
    /^\s*open\s+(?:the\s+)?system\s+settings?\s*\.?\s*$/i.test(cmd)
  ) {
    return { kind: "system_action", action: "open_settings" };
  }

  return null;
}
