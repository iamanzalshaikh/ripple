import type { CompilerDiagnostic } from "../../automation/shell/compilerDiagnostics.js";

export type PendingCodeRepair = {
  projectPath: string;
  wantsTests: boolean;
  /** True when the original utterance already authorized applying fixes. */
  autoApply: boolean;
  sourceUtterance: string;
  diagnostics: CompilerDiagnostic[];
  createdAt: number;
};

let pending: PendingCodeRepair | null = null;

const SESSION_TTL_MS = 30 * 60 * 1000;

function isExpired(row: PendingCodeRepair): boolean {
  return Date.now() > row.createdAt + SESSION_TTL_MS;
}

/** Remember that inspection finished and repair is waiting (voice or auto). */
export function setPendingCodeRepair(
  input: Omit<PendingCodeRepair, "diagnostics" | "createdAt" | "autoApply"> & {
    diagnostics?: CompilerDiagnostic[];
    autoApply?: boolean;
  },
): void {
  pending = {
    projectPath: input.projectPath.trim(),
    wantsTests: input.wantsTests,
    autoApply: input.autoApply ?? false,
    sourceUtterance: input.sourceUtterance,
    diagnostics: input.diagnostics ?? pending?.diagnostics ?? [],
    createdAt: Date.now(),
  };
}

/** Attach typecheck diagnostics gathered during the audit plan. */
export function recordCodeRepairDiagnostics(
  projectRoot: string,
  diagnostics: CompilerDiagnostic[],
): void {
  const root = projectRoot.trim();
  if (!root) return;

  if (pending && !isExpired(pending)) {
    pending.projectPath = root;
    pending.diagnostics = diagnostics;
    pending.createdAt = Date.now();
    return;
  }

  if (diagnostics.length === 0) return;

  pending = {
    projectPath: root,
    wantsTests: false,
    autoApply: false,
    sourceUtterance: "",
    diagnostics,
    createdAt: Date.now(),
  };
}

export function getPendingCodeRepair(): PendingCodeRepair | null {
  if (!pending) return null;
  if (isExpired(pending)) {
    pending = null;
    return null;
  }
  return pending;
}

export function clearPendingCodeRepair(): void {
  pending = null;
}

export function clearCodeRepairSessionForTests(): void {
  pending = null;
}
