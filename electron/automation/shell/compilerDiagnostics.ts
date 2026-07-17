export type CompilerDiagnostic = {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  source: "typescript" | "eslint";
};

/** Parse `tsc --noEmit` stdout/stderr (Windows + POSIX formats). */
export function parseTscOutput(output: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const seen = new Set<string>();

  const patterns = [
    // src/file.ts(68,5): error TS1109: Expression expected.
    /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/i,
    // src/file.ts:68:5 - error TS1109: Expression expected.
    /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/i,
    // src/file.ts:68:5: error TS1109: Expression expected.
    /^(.+?):(\d+):(\d+):\s*error\s+(TS\d+):\s*(.+)$/i,
  ];

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;

      const [, file, lineNo, col, code, message] = match;
      const key = `${file}:${lineNo}:${code}`;
      if (seen.has(key)) break;
      seen.add(key);

      diagnostics.push({
        file: file!.trim(),
        line: Number(lineNo),
        column: Number(col),
        code: code!.trim(),
        message: message!.trim(),
        source: "typescript",
      });
      break;
    }
  }

  return diagnostics;
}

/** Parse ESLint stylish/compact output lines. */
export function parseEslintOutput(output: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // path:line:col: severity message (rule)
    const match = trimmed.match(
      /^(.+?):(\d+):(\d+):\s*(error|warning)\s+(.+?)(?:\s+\(([a-z0-9@/_-]+)\))?$/i,
    );
    if (!match) continue;

    const [, file, lineNo, col, severity, message, rule] = match;
    if (severity?.toLowerCase() === "warning") continue;

    const code = rule?.trim() || "eslint";
    const key = `${file}:${lineNo}:${code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    diagnostics.push({
      file: file!.trim(),
      line: Number(lineNo),
      column: Number(col),
      code,
      message: message!.trim(),
      source: "eslint",
    });
  }

  return diagnostics;
}

function suggestFix(
  diagnostic: CompilerDiagnostic,
  contextLine?: string,
  previousLine?: string,
): string | null {
  const line = contextLine ?? "";
  const prev = previousLine ?? "";

  if (
    diagnostic.code === "TS1109" &&
    (/\bdisplayOrder\s*:/.test(line) ||
      /\bdisplayOrder\s*:/.test(prev) ||
      /displayOrder/i.test(diagnostic.message))
  ) {
    return "Assign a value, e.g. displayOrder: 0";
  }
  if (
    (diagnostic.code === "TS1109" || diagnostic.code === "TS1005") &&
    /^\s*[A-Za-z_$][\w$]*\s*:\s*$/.test(prev.trim() ? prev : line)
  ) {
    const prop = (prev.trim() || line.trim()).match(/^([A-Za-z_$][\w$]*)\s*:/);
    if (prop?.[1]) {
      return `Complete property \`${prop[1]}\` with a value, e.g. ${prop[1]}: 0`;
    }
  }
  if (diagnostic.code === "TS1109") {
    return "Complete the expression or property value before the next token";
  }
  if (diagnostic.code === "TS1005") {
    return "Add the missing punctuation or value (often a comma, colon, or closing brace)";
  }
  if (diagnostic.code === "TS2322") {
    return "Ensure the assigned value matches the expected type";
  }
  return null;
}

export function formatCompilerReport(args: {
  title: string;
  command: string;
  diagnostics: CompilerDiagnostic[];
  projectRoot?: string;
  contextLines?: Map<string, string[]>;
}): string {
  const { title, command, diagnostics, contextLines } = args;
  const lines: string[] = [`${title} (${command})`, ""];

  if (!diagnostics.length) {
    lines.push("✓ No errors found");
    return lines.join("\n");
  }

  lines.push(
    `Found ${diagnostics.length} error${diagnostics.length === 1 ? "" : "s"}`,
    "",
  );

  diagnostics.slice(0, 20).forEach((diag, index) => {
    const rel = diag.file.replace(/\\/g, "/");
    lines.push(`${index + 1}. ${rel}`);
    lines.push(`   Line: ${diag.line}`);
    lines.push(`   Code: ${diag.code}`);
    lines.push(`   Issue: ${diag.message}`);

    const ctx = contextLines?.get(diag.file);
    const ctxLine = ctx?.[diag.line - 1]?.trim();
    const prevLine = ctx?.[diag.line - 2]?.trim();
    if (ctxLine) {
      lines.push(`   Snippet: ${ctxLine.slice(0, 120)}`);
    }
    if (prevLine && /^[A-Za-z_$][\w$]*\s*:\s*$/.test(prevLine)) {
      lines.push(`   Context: ${prevLine.slice(0, 120)}`);
    }

    const fix = suggestFix(diag, ctxLine, prevLine);
    if (fix) lines.push(`   Fix: ${fix}`);
    lines.push("");
  });

  if (diagnostics.length > 20) {
    lines.push(`…and ${diagnostics.length - 20} more error(s)`);
  }

  return lines.join("\n").trimEnd();
}
