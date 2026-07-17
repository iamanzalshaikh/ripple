import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runShellCommand, truncateShellOutput } from "./runCommand.js";

export type TestRunnerKind = "npm" | "pnpm" | "yarn" | "pytest" | "cargo" | "unknown";

export function detectTestRunner(projectRoot: string): TestRunnerKind {
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        packageManager?: string;
      };
      const pm = (pkg.packageManager ?? "").toLowerCase();
      if (pm.startsWith("pnpm")) return "pnpm";
      if (pm.startsWith("yarn")) return "yarn";
    } catch {
      /* ignore */
    }
    if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
    return "npm";
  }
  if (existsSync(join(projectRoot, "pyproject.toml"))) return "pytest";
  if (existsSync(join(projectRoot, "Cargo.toml"))) return "cargo";
  return "unknown";
}

export function buildTestCommand(runner: TestRunnerKind): string {
  switch (runner) {
    case "pnpm":
      return "pnpm test";
    case "yarn":
      return "yarn test";
    case "npm":
      return "npm test";
    case "pytest":
      return "pytest";
    case "cargo":
      return "cargo test";
    default:
      return "npm test";
  }
}

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

/** Return the first usable test script name from package.json, if any. */
export function detectPackageTestScript(projectRoot: string): string | null {
  const scripts = readPackageScripts(projectRoot);
  if (!scripts) return null;

  const candidates = ["test", "test:unit", "test:ci", "test:run"];
  for (const name of candidates) {
    const script = scripts[name]?.trim();
    if (script) return name;
  }
  return null;
}

export function detectTestCommand(
  projectRoot: string,
): { runner: TestRunnerKind; command: string } | null {
  const cwd = projectRoot.trim();
  if (!cwd || !existsSync(cwd)) return null;

  const runner = detectTestRunner(cwd);
  if (runner === "pytest" || runner === "cargo") {
    return { runner, command: buildTestCommand(runner) };
  }

  const scriptName = detectPackageTestScript(cwd);
  if (!scriptName) return null;

  const command =
    runner === "pnpm"
      ? `pnpm run ${scriptName}`
      : runner === "yarn"
        ? `yarn ${scriptName}`
        : `npm run ${scriptName}`;
  return { runner, command };
}

export async function runProjectTests(projectRoot: string): Promise<string> {
  const cwd = projectRoot.trim();
  if (!cwd || !existsSync(cwd)) {
    throw new Error("test_cwd_missing");
  }

  const detected = detectTestCommand(cwd);
  if (!detected) {
    if (existsSync(join(cwd, "package.json"))) {
      throw new Error(
        'no_test_script:package.json has no "test" script — add one or run tests manually',
      );
    }
    throw new Error("no_test_script:no supported test runner found for this project");
  }

  const result = await runShellCommand(detected.command, {
    cwd,
    timeoutMs: 120_000,
  });
  const summary = truncateShellOutput(result.output);
  if (result.exitCode !== 0) {
    throw new Error(summary || `tests_failed:exit=${result.exitCode}`);
  }
  return summary || `${detected.command} passed`;
}
