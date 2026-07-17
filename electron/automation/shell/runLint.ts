import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatCompilerReport,
  parseEslintOutput,
} from "./compilerDiagnostics.js";
import { runShellCommand } from "./runCommand.js";
import { detectTestRunner } from "./runTests.js";
import { resolveAutomationProjectRoot } from "./projectScan.js";
import { clampToExistingPath } from "./projectPathNormalize.js";

type PackageScripts = Record<string, string>;

const ESLINT_CONFIG_NAMES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc",
];

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

export function hasEslintProject(projectRoot: string): boolean {
  const root = projectRoot.trim();
  if (!root) return false;
  if (ESLINT_CONFIG_NAMES.some((name) => existsSync(join(root, name)))) {
    return true;
  }
  const scripts = readPackageScripts(root);
  return Boolean(scripts?.lint?.trim());
}

export function detectLintCommand(
  projectRoot: string,
): { command: string; label: string } | null {
  const root = projectRoot.trim();
  if (!root || !existsSync(root)) return null;

  const scripts = readPackageScripts(root);
  const lintScript = scripts?.lint?.trim();
  if (lintScript) {
    const runner = detectTestRunner(root);
    const command =
      runner === "pnpm"
        ? "pnpm run lint"
        : runner === "yarn"
          ? "yarn lint"
          : "npm run lint";
    return { command, label: command };
  }

  if (!hasEslintProject(root)) return null;
  return { command: "npx eslint .", label: "npx eslint ." };
}

export async function runProjectLint(projectRoot: string): Promise<string> {
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

  const resolved = resolveAutomationProjectRoot(requested, hintPath);
  const root = resolved?.root ?? requested;

  const detected = detectLintCommand(root);
  if (!detected) {
    return "ESLint check skipped — no eslint config or lint script found in this project.";
  }

  console.info(
    `[ripple-tool-args] tool=automation.lint resolved_arguments=${JSON.stringify({ projectRoot: root, requested, cmd: detected.command })}`,
  );

  const result = await runShellCommand(detected.command, {
    cwd: root,
    timeoutMs: 180_000,
  });

  const diagnostics = parseEslintOutput(result.output);
  return formatCompilerReport({
    title: "ESLint check",
    command: detected.label,
    diagnostics,
    projectRoot: root,
  });
}
