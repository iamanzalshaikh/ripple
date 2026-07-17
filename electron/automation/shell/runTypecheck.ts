import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatCompilerReport,
  parseTscOutput,
  type CompilerDiagnostic,
} from "./compilerDiagnostics.js";
import { runShellCommand } from "./runCommand.js";
import { detectTestRunner } from "./runTests.js";
import { resolveAutomationProjectRoot } from "./projectScan.js";
import { clampToExistingPath } from "./projectPathNormalize.js";

/** Thrown-free marker for "nothing to typecheck" so callers can soft-skip. */
export const TYPECHECK_SKIPPED = "no_typescript";

type PackageScripts = Record<string, string>;

function readPackageScripts(projectRoot: string): PackageScripts | null {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: PackageScripts;
    };
    return pkg.scripts ?? {};
  } catch {
    return null;
  }
}

export function hasTypeScriptProject(projectRoot: string): boolean {
  const root = projectRoot.trim();
  if (!root) return false;
  return (
    existsSync(join(root, "tsconfig.json")) ||
    existsSync(join(root, "tsconfig.app.json")) ||
    existsSync(join(root, "jsconfig.json"))
  );
}

/**
 * Vite / solution-style projects often have root tsconfig.json with
 * `"files": []` + references to tsconfig.app.json. Bare `tsc --noEmit`
 * then succeeds with zero checks. Prefer the app config or `tsc -b`.
 */
export function resolveTscNoEmitCommand(projectRoot: string): string {
  const root = projectRoot.trim();
  const appConfig = join(root, "tsconfig.app.json");
  if (existsSync(appConfig)) {
    return "npx tsc -p tsconfig.app.json --noEmit";
  }

  const rootConfig = join(root, "tsconfig.json");
  if (existsSync(rootConfig)) {
    try {
      const raw = readFileSync(rootConfig, "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        "",
      );
      const ts = JSON.parse(raw) as {
        files?: unknown[];
        references?: unknown[];
      };
      if (Array.isArray(ts.references) && ts.references.length > 0) {
        return "npx tsc -b --pretty false";
      }
      if (Array.isArray(ts.files) && ts.files.length === 0) {
        return "npx tsc -b --pretty false";
      }
    } catch {
      /* fall through */
    }
  }

  return "npx tsc --noEmit";
}

function isBareTscNoEmit(script: string): boolean {
  const s = script.trim().replace(/^npx\s+/, "");
  return (
    /^tsc(\s+--pretty\s+false)?\s+--noEmit$/i.test(s) ||
    /^tsc\s+--noEmit(\s+--pretty\s+false)?$/i.test(s) ||
    /^tsc\s+-b$/i.test(s)
  );
}

export function detectTypecheckCommand(
  projectRoot: string,
): { command: string; label: string } | null {
  const root = projectRoot.trim();
  if (!root || !existsSync(root)) return null;

  const scripts = readPackageScripts(root);
  const scriptCandidates = [
    "typecheck",
    "type-check",
    "check:types",
    "check-types",
    "tsc",
  ];
  if (scripts) {
    for (const name of scriptCandidates) {
      const script = scripts[name]?.trim();
      if (!script) continue;
      // Upgrade naive `tsc --noEmit` scripts that miss solution/app configs.
      if (isBareTscNoEmit(script)) {
        const smart = resolveTscNoEmitCommand(root);
        return { command: smart, label: smart };
      }
      const runner = detectTestRunner(root);
      const command =
        runner === "pnpm"
          ? `pnpm run ${name}`
          : runner === "yarn"
            ? `yarn ${name}`
            : `npm run ${name}`;
      return { command, label: command };
    }
  }

  if (!hasTypeScriptProject(root)) return null;
  const command = resolveTscNoEmitCommand(root);
  return { command, label: command };
}

function loadContextLines(
  projectRoot: string,
  diagnostics: CompilerDiagnostic[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const diag of diagnostics) {
    if (map.has(diag.file)) continue;
    const abs = diag.file.includes(":")
      ? diag.file
      : join(projectRoot, diag.file);
    try {
      const content = readFileSync(abs, "utf8");
      map.set(diag.file, content.split(/\r?\n/));
    } catch {
      /* skip unreadable */
    }
  }
  return map;
}

export async function runProjectTypecheck(projectRoot: string): Promise<string> {
  const detailed = await runProjectTypecheckDetailed(projectRoot);
  return detailed.report;
}

export async function runProjectTypecheckDetailed(projectRoot: string): Promise<{
  report: string;
  diagnostics: CompilerDiagnostic[];
  skipped?: boolean;
  /** Actual package cwd used for tsc (may differ from monorepo workspace root). */
  resolvedRoot?: string;
}> {
  const requestedRaw = projectRoot.trim();
  if (!requestedRaw) {
    throw new Error("project_root_missing");
  }

  const requested = clampToExistingPath(requestedRaw);
  if (!requested || !existsSync(requested)) {
    throw new Error("project_root_missing");
  }

  let hintPath: string | null = null;
  try {
    const { resolveLiveIdeContext } = await import(
      "../../agent/planner/tools/desktopTools.js"
    );
    hintPath = resolveLiveIdeContext()?.filePath ?? null;
  } catch {
    /* optional */
  }

  // Always re-resolve: monorepo parents and spoken-path tails must not win.
  const resolved = resolveAutomationProjectRoot(requested, hintPath);
  const root = resolved?.root ?? requested;

  const detected = detectTypecheckCommand(root);
  if (!detected) {
    return {
      diagnostics: [],
      skipped: true,
      resolvedRoot: root,
      report:
        "TypeScript check skipped — no tsconfig.json or typecheck script found in this project.",
    };
  }

  console.info(
    `[ripple-tool-args] tool=automation.typecheck resolved_arguments=${JSON.stringify({ projectRoot: root, requested, cmd: detected.command })}`,
  );
  console.info(
    `[ripple-desktop] typecheck cwd=${root} cmd=${detected.command}`,
  );

  const result = await runShellCommand(detected.command, {
    cwd: root,
    timeoutMs: 180_000,
  });

  const diagnostics = parseTscOutput(result.output);
  const contextLines = loadContextLines(root, diagnostics);

  return {
    diagnostics,
    resolvedRoot: root,
    report: formatCompilerReport({
      title: "TypeScript check",
      command: detected.label,
      diagnostics,
      projectRoot: root,
      contextLines,
    }),
  };
}
