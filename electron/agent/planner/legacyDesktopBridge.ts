import type { CommandResultPayload } from "../../automation/types.js";

/** Desktop kinds that still execute via `_desktopPayload` (no dedicated P8.5 tool yet). */
const LEGACY_PAYLOAD_KINDS = new Set([
  "recall_memory",
  "remember_alias",
  "open_alias",
  "list_aliases",
  "remove_alias",
  "remember_workflow",
  "run_workflow",
  "list_workflows",
  "remove_workflow",
]);

function readDesktopKind(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const direct = data.desktopKind;
  if (typeof direct === "string") return direct;

  const steps = data.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const first = steps[0] as { data?: Record<string, unknown> } | undefined;
  const nested = first?.data?.desktopKind;
  return typeof nested === "string" ? nested : null;
}

export function desktopPayloadNeedsLegacyBridge(
  desktop: CommandResultPayload,
): boolean {
  const kind = readDesktopKind(
    desktop.actions?.[0]?.data as Record<string, unknown> | undefined,
  );
  return typeof kind === "string" && LEGACY_PAYLOAD_KINDS.has(kind);
}
