export type PermissionLevel = "allowed" | "confirm" | "blocked";

export type ToolRisk = "low" | "medium" | "high";

const HIGH_RISK_KINDS = new Set([
  "delete_file",
  "move_file",
  "rename_file",
  "create_file",
  "create_folder",
]);

export function riskForDesktopKind(kind: string): ToolRisk {
  if (kind === "delete_file") return "high";
  if (HIGH_RISK_KINDS.has(kind)) return "medium";
  return "low";
}

export function isDestructiveKind(kind: string): boolean {
  return kind === "delete_file" || kind === "move_file" || kind === "rename_file";
}
