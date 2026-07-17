import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { CompilerDiagnostic } from "./compilerDiagnostics.js";

export type ProposedCodeRepair = {
  path: string;
  find: string;
  replace: string;
  reason: string;
  diagnostic: CompilerDiagnostic;
};

function resolveDiagPath(projectRoot: string, file: string): string {
  if (isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file)) return file;
  return join(projectRoot, file);
}

function lineAt(content: string, line: number): string | null {
  if (line < 1) return null;
  const lines = content.split(/\r?\n/);
  return lines[line - 1] ?? null;
}

/**
 * Build safe find/replace patches from TypeScript diagnostics.
 * Handles incomplete properties and broken generics (e.g. `Record<\n{`).
 */
export function proposeCodeRepairsFromDiagnostics(
  projectRoot: string,
  diagnostics: CompilerDiagnostic[],
): ProposedCodeRepair[] {
  const root = projectRoot.trim();
  if (!root || !existsSync(root)) return [];

  const proposals: ProposedCodeRepair[] = [];
  const seen = new Set<string>();

  for (const diag of diagnostics) {
    if (diag.source !== "typescript") continue;
    const abs = resolveDiagPath(root, diag.file);
    if (!existsSync(abs)) continue;

    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    const fromDiag = proposeForDiagnostic(abs, diag, content);
    const extras = scanFileForSafeRepairs(abs, diag, content);
    for (const proposal of [fromDiag, ...extras].filter(Boolean) as ProposedCodeRepair[]) {
      const key = `${proposal.path}|${proposal.find}|${proposal.replace}`;
      if (seen.has(key)) continue;
      if (!content.includes(proposal.find)) continue;
      if (proposal.find === proposal.replace) continue;
      seen.add(key);
      proposals.push(proposal);
    }
  }

  return proposals;
}

function proposeForDiagnostic(
  absPath: string,
  diag: CompilerDiagnostic,
  content: string,
): ProposedCodeRepair | null {
  const candidateLines = [diag.line, diag.line - 1, diag.line - 2, diag.line + 1]
    .map((n) => ({ lineNo: n, text: lineAt(content, n) }))
    .filter((c): c is { lineNo: number; text: string } => Boolean(c.text));

  for (const candidate of candidateLines) {
    const hit = proposeFromLine(absPath, diag, candidate.text, content);
    if (hit) return hit;
  }

  // Unclosed JSX/HTML attribute quotes often report on the *next* line.
  if (
    diag.code === "TS1003" ||
    diag.code === "TS1382" ||
    diag.code === "TS1005" ||
    diag.code === "TS1002" ||
    /Identifier expected|Unexpected token|Unterminated string/i.test(diag.message)
  ) {
    const quote = proposeUnclosedAttributeQuote(absPath, diag, content);
    if (quote) return quote;
    const unterminated = proposeUnterminatedStringLiteral(absPath, diag, content);
    if (unterminated) return unterminated;
  }

  // TS2304 truncated type: `centerRedImage?: st` → `string`
  if (diag.code === "TS2304" || /Cannot find name/i.test(diag.message)) {
    const truncated = proposeTruncatedTypeName(absPath, diag, content);
    if (truncated) return truncated;
  }

  // TS2314 / broken generic: Record<\n\n  {
  if (diag.code === "TS2314" || /Generic type 'Record'/i.test(diag.message)) {
    return proposeIncompleteRecord(absPath, diag, content);
  }

  return null;
}

/** Extra file scan when tsc points at a cascade line. */
function scanFileForSafeRepairs(
  absPath: string,
  diag: CompilerDiagnostic,
  content: string,
): ProposedCodeRepair[] {
  const out: ProposedCodeRepair[] = [];
  const record = proposeIncompleteRecord(absPath, diag, content);
  if (record) out.push(record);

  // Incomplete object properties anywhere near the diagnostic.
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, diag.line - 8);
  const end = Math.min(lines.length, diag.line + 8);
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const propMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:\s*,?\s*$/);
    if (!propMatch) continue;
    const prop = propMatch[1]!;
    const find = extractPropertyOccurrence(content, line, prop);
    if (!find) continue;
    const replace = find.replace(
      new RegExp(`(${escapeRegExp(prop)}\\s*:)\\s*,?\\s*$`),
      "$1 0",
    );
    if (replace === find) continue;
    out.push({
      path: absPath,
      find,
      replace,
      reason: `${diag.code}: complete property \`${prop}\` with a placeholder value`,
      diagnostic: diag,
    });
  }
  return out;
}

/**
 * Fix `cy="18` → `cy="18"` (unclosed JSX/HTML attribute quote).
 */
function proposeUnclosedAttributeQuote(
  absPath: string,
  diag: CompilerDiagnostic,
  content: string,
): ProposedCodeRepair | null {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, diag.line - 4);
  const end = Math.min(lines.length, diag.line + 1);
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    const trimmed = line.trimEnd();
    // attr="value   OR   attr='value   (no closing quote on this line)
    const m = trimmed.match(/^(\s*[A-Za-z_:][\w:.-]*=)(["'])([^"'>\s]*)$/);
    if (!m) continue;
    const find = trimmed;
    const replace = `${m[1]}${m[2]}${m[3]}${m[2]}`;
    if (find === replace) continue;
    if (!content.includes(find)) continue;
    return {
      path: absPath,
      find,
      replace,
      reason: `${diag.code}: close unclosed attribute quote`,
      diagnostic: diag,
    };
  }
  return null;
}

/**
 * Fix unterminated string literals inside JSX expressions, e.g.
 * `to={primaryAction.to || "#}` → `to={primaryAction.to || "#"}`
 * (TS1002 Unterminated string literal).
 */
function proposeUnterminatedStringLiteral(
  absPath: string,
  diag: CompilerDiagnostic,
  content: string,
): ProposedCodeRepair | null {
  const line = lineAt(content, diag.line);
  if (!line) return null;
  const trimmed = line.trimEnd();

  // Common: `|| "#}` or `|| '#}` missing closing quote before `}`
  const orHash = trimmed.match(
    /^(.*?\|\|\s*)(["'])(#)(\})(.*)$/,
  );
  if (orHash) {
    const find = trimmed;
    const replace = `${orHash[1]}${orHash[2]}${orHash[3]}${orHash[2]}${orHash[4]}${orHash[5]}`;
    if (find !== replace && content.includes(find)) {
      return {
        path: absPath,
        find,
        replace,
        reason: `${diag.code}: close unterminated string before }`,
        diagnostic: diag,
      };
    }
  }

  // Generic: odd number of quotes on the diagnostic line ending with `}` / `/>` / `>`
  const doubleQuotes = (trimmed.match(/"/g) ?? []).length;
  const singleQuotes = (trimmed.match(/'/g) ?? []).length;
  if (doubleQuotes % 2 === 1) {
    // Insert `"` before the last `}` on the line if present
    const m = trimmed.match(/^(.*[^"'])(\})(\s*<\/.*)?$/);
    if (m && content.includes(trimmed)) {
      const replace = `${m[1]}"${m[2]}${m[3] ?? ""}`;
      if (replace !== trimmed) {
        return {
          path: absPath,
          find: trimmed,
          replace,
          reason: `${diag.code}: close unterminated double-quoted string`,
          diagnostic: diag,
        };
      }
    }
  }
  if (singleQuotes % 2 === 1) {
    const m = trimmed.match(/^(.*[^"'])(\})(\s*<\/.*)?$/);
    if (m && content.includes(trimmed)) {
      const replace = `${m[1]}'${m[2]}${m[3] ?? ""}`;
      if (replace !== trimmed) {
        return {
          path: absPath,
          find: trimmed,
          replace,
          reason: `${diag.code}: close unterminated single-quoted string`,
          diagnostic: diag,
        };
      }
    }
  }

  return null;
}

/**
 * Fix `Record<\n\n  {` → `Record<\n  string,\n  {` (jkf TS2314 case).
 */
function proposeIncompleteRecord(
  absPath: string,
  diag: CompilerDiagnostic,
  content: string,
): ProposedCodeRepair | null {
  const match = content.match(
    /(Record\s*<)\s*(\r?\n)\s*(\{)/,
  );
  if (!match || match.index === undefined) return null;

  const find = match[0];
  const nl = match[2] ?? "\n";
  // Preserve indentation of the `{` line when possible.
  const braceIndent = find.match(/\n([ \t]*)\{/)?.[1] ?? "  ";
  const replace = `${match[1]}${nl}${braceIndent}string,${nl}${braceIndent}{`;
  if (find === replace) return null;

  return {
    path: absPath,
    find,
    replace,
    reason: `${diag.code}: add missing Record type arguments (string, ...)`,
    diagnostic: diag,
  };
}

function proposeFromLine(
  absPath: string,
  diag: CompilerDiagnostic,
  line: string,
  content: string,
): ProposedCodeRepair | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "}," || trimmed === "}" || trimmed === "{") {
    return null;
  }

  // Incomplete type annotation on a property (TS2304 / Cannot find name 'st')
  if (diag.code === "TS2304" || /Cannot find name/i.test(diag.message)) {
    const truncated = proposeTruncatedTypeOnLine(
      absPath,
      diag,
      line,
      content,
    );
    if (truncated) return truncated;
  }

  if (
    diag.code === "TS1109" ||
    diag.code === "TS1005" ||
    diag.code === "TS2314"
  ) {
    const propMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:\s*,?\s*$/);
    if (propMatch) {
      const prop = propMatch[1]!;
      const find = extractPropertyOccurrence(content, line, prop);
      if (!find) return null;
      const replace = find.replace(
        new RegExp(`(${escapeRegExp(prop)}\\s*:)\\s*,?\\s*$`),
        "$1 0",
      );
      if (replace === find) return null;
      return {
        path: absPath,
        find,
        replace,
        reason: `${diag.code}: complete property \`${prop}\` with a placeholder value`,
        diagnostic: diag,
      };
    }

    const assignMatch = trimmed.match(/^(.+?=\s*)$/);
    if (assignMatch && (diag.code === "TS1109" || diag.code === "TS1005")) {
      const find = line.trimEnd().replace(/\r$/, "");
      const replace = `${assignMatch[1]}null;`.trimEnd();
      if (!content.includes(find)) return null;
      return {
        path: absPath,
        find,
        replace,
        reason: `${diag.code}: complete unfinished assignment`,
        diagnostic: diag,
      };
    }
  }

  return null;
}

/** Map common truncated type stubs to full TypeScript types. */
const TRUNCATED_TYPE_COMPLETIONS: Record<string, string> = {
  st: "string",
  str: "string",
  stri: "string",
  nu: "number",
  num: "number",
  numb: "number",
  bo: "boolean",
  bool: "boolean",
  boole: "boolean",
};

/**
 * Fix `centerRedImage?: st` → `centerRedImage?: string` (TS2304 truncated type).
 */
function proposeTruncatedTypeOnLine(
  absPath: string,
  diag: CompilerDiagnostic,
  line: string,
  content: string,
): ProposedCodeRepair | null {
  const withoutCr = line.replace(/\r$/, "");
  const match = withoutCr.match(
    /^(\s*[A-Za-z_$][\w$]*\??\s*:\s*)([A-Za-z_$][\w$]*)(\s*;?\s*)$/,
  );
  if (!match) return null;

  const prefix = match[1]!;
  const stub = match[2]!;
  const suffix = match[3] ?? "";
  const completed = TRUNCATED_TYPE_COMPLETIONS[stub];
  if (!completed) return null;

  // Prefer completing the name cited in the diagnostic message.
  const cited = diag.message.match(/Cannot find name '([^']+)'/i)?.[1];
  if (cited && cited !== stub) return null;

  const find = withoutCr;
  const replace = `${prefix}${completed}${suffix}`;
  if (!content.includes(find) || find === replace) return null;

  return {
    path: absPath,
    find,
    replace,
    reason: `${diag.code}: complete truncated type \`${stub}\` → \`${completed}\``,
    diagnostic: diag,
  };
}

function proposeTruncatedTypeName(
  absPath: string,
  diag: CompilerDiagnostic,
  content: string,
): ProposedCodeRepair | null {
  const lines = content.split(/\r?\n/);
  const candidateLines = [diag.line, diag.line - 1, diag.line + 1];
  for (const lineNo of candidateLines) {
    const text = lines[lineNo - 1];
    if (!text) continue;
    const hit = proposeTruncatedTypeOnLine(absPath, diag, text, content);
    if (hit) return hit;
  }
  return null;
}

function extractPropertyOccurrence(
  content: string,
  line: string,
  prop: string,
): string | null {
  const withoutCr = line.replace(/\r$/, "");
  if (content.includes(withoutCr)) return withoutCr;
  const trimmed = withoutCr.trimEnd();
  if (content.includes(trimmed)) return trimmed;

  const indent = line.match(/^\s*/)?.[0] ?? "";
  const rebuilt = `${indent}${prop}:`;
  if (content.includes(rebuilt)) return rebuilt;

  const withSpace = `${rebuilt} `;
  if (content.includes(withSpace)) return withSpace;
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
