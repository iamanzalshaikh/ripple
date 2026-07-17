export type PermissionLevel = "allowed" | "confirm" | "blocked";

export type ToolRisk = "low" | "medium" | "high";

const HIGH_RISK_KINDS = new Set([
  "delete_file",
  "move_file",
  "copy_file",
  "rename_file",
  "create_file",
  "create_folder",
  "write_file",
  "patch_file",
  "run_as_admin",
]);

const CONFIRM_KINDS = new Set([
  "delete_file",
  "move_file",
  "copy_file",
  "rename_file",
  "create_file",
  "write_file",
  "patch_file",
  "run_as_admin",
]);

/** Desktop workflow kinds that always need Safety confirm (P4.5). */
export function permissionForDesktopKind(kind: string): PermissionLevel {
  if (
    kind === "delete_file" ||
    kind === "move_file" ||
    kind === "copy_file" ||
    kind === "rename_file" ||
    kind === "run_as_admin"
  ) {
    return "confirm";
  }
  if (kind === "create_file") return "confirm";
  if (kind === "write_file" || kind === "patch_file") return "confirm";
  return "allowed";
}

export function riskForDesktopKind(kind: string): ToolRisk {
  if (kind === "delete_file" || kind === "patch_file" || kind === "run_as_admin") {
    return "high";
  }
  if (HIGH_RISK_KINDS.has(kind)) return "medium";
  return "low";
}

export function isDestructiveKind(kind: string): boolean {
  return CONFIRM_KINDS.has(kind);
}

export function isHighRiskKind(kind: string): boolean {
  return kind === "delete_file";
}
