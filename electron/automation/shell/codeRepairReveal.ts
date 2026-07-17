import { basename, isAbsolute, join } from "node:path";
import type { CompilerDiagnostic } from "./compilerDiagnostics.js";
import {
  proposeCodeRepairsFromDiagnostics,
  type ProposedCodeRepair,
} from "./proposeCodeRepairs.js";
import { openFileAtLineInIde, resolveIdeApp } from "./projectResolver.js";

export type CodeRepairPanelPayload = {
  file: string;
  fileName: string;
  line: number;
  code: string;
  message: string;
  why: string;
  suggestedFix: string;
  before?: string;
  after?: string;
  hasSafePatch: boolean;
  projectRoot: string;
};

function resolveDiagAbs(projectRoot: string, file: string): string {
  if (isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file)) return file;
  return join(projectRoot, file);
}

/** Human-readable "why" from a diagnostic + optional proposal. */
export function explainDiagnostic(
  diag: CompilerDiagnostic,
  proposal?: ProposedCodeRepair | null,
): string {
  if (proposal?.reason) {
    const stripped = proposal.reason.replace(/^TS\d+:\s*/i, "").trim();
    if (stripped) return stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }
  if (/Generic type 'Record'/i.test(diag.message) || diag.code === "TS2314") {
    return "Incomplete Record generic — missing type arguments";
  }
  if (diag.code === "TS2304" || /Cannot find name/i.test(diag.message)) {
    const name = diag.message.match(/Cannot find name '([^']+)'/i)?.[1];
    if (name && ["st", "str", "stri"].includes(name)) {
      return `Truncated type name \`${name}\` — likely meant \`string\``;
    }
    return name
      ? `Unknown identifier \`${name}\` — likely a truncated type`
      : "Unknown identifier — likely a truncated type name";
  }
  if (diag.code === "TS1109" || /Expression expected/i.test(diag.message)) {
    return "Incomplete object property or unfinished expression";
  }
  if (diag.code === "TS1005") {
    return "Missing punctuation or incomplete syntax";
  }
  return diag.message;
}

export function suggestFixLabel(
  diag: CompilerDiagnostic,
  proposal?: ProposedCodeRepair | null,
): string {
  if (proposal) {
    if (/displayOrder/i.test(proposal.find + proposal.replace)) {
      return "Complete displayOrder value";
    }
    if (/Record\s*</i.test(proposal.find)) {
      return "Add missing Record type arguments (string, …)";
    }
    const prop = proposal.find.match(/^[\s]*([A-Za-z_$][\w$]*)\s*:/)?.[1];
    if (prop) return `Complete ${prop} value`;
    return proposal.reason.replace(/^TS\d+:\s*/i, "") || "Apply safe auto-patch";
  }
  return "Manual review needed";
}

export function buildCodeRepairPanelPayload(
  projectRoot: string,
  diagnostics: CompilerDiagnostic[],
): CodeRepairPanelPayload | null {
  if (!diagnostics.length) return null;
  const diag = diagnostics[0]!;
  const proposals = proposeCodeRepairsFromDiagnostics(projectRoot, diagnostics);
  const proposal = proposals[0] ?? null;
  const abs = resolveDiagAbs(projectRoot, diag.file);
  const rel = diag.file.replace(/\\/g, "/");

  return {
    file: abs,
    fileName: rel.includes("/") ? rel : basename(abs).replace(/\\/g, "/"),
    line: diag.line,
    code: diag.code,
    message: diag.message,
    why: explainDiagnostic(diag, proposal),
    suggestedFix: suggestFixLabel(diag, proposal),
    before: proposal?.find?.trim().slice(0, 120),
    after: proposal?.replace?.trim().slice(0, 120),
    hasSafePatch: Boolean(proposal),
    projectRoot,
  };
}

/** Jump Cursor/VS Code to the first diagnostic and keep the IDE foreground. */
export async function revealDiagnosticInIde(
  projectRoot: string,
  diag: CompilerDiagnostic,
): Promise<string | null> {
  const ide = resolveIdeApp();
  if (!ide) {
    console.info("[ripple-p85] code_repair reveal: no IDE found");
    return null;
  }
  const abs = resolveDiagAbs(projectRoot, diag.file);
  try {
    const msg = await openFileAtLineInIde(abs, diag.line, ide, {
      column: diag.column || 1,
    });
    console.info(`[ripple-p85] code_repair reveal: ${msg}`);
    return msg;
  } catch (e: unknown) {
    console.warn(
      "[ripple-p85] code_repair reveal failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** After typecheck: open first error in IDE. Returns panel payload for overlay. */
export async function revealCodeRepairAfterTypecheck(
  projectRoot: string,
  diagnostics: CompilerDiagnostic[],
): Promise<CodeRepairPanelPayload | null> {
  if (!diagnostics.length) return null;
  const payload = buildCodeRepairPanelPayload(projectRoot, diagnostics);
  if (!payload) return null;
  await revealDiagnosticInIde(projectRoot, diagnostics[0]!);
  return payload;
}
