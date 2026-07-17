import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findPackageRoots,
  resolveAutomationProjectRoot,
  resolvePrimaryPackageRoot,
} from "../projectScan.js";
import {
  detectTypecheckCommand,
  runProjectTypecheckDetailed,
} from "../runTypecheck.js";
import { runProjectLint } from "../runLint.js";
import { proposeCodeRepairsFromDiagnostics } from "../proposeCodeRepairs.js";
import { extractWindowsPath } from "../../../agent/planner/parseAutomationClause.js";
import { trimSpokenPathTail } from "../projectPathNormalize.js";

describe("monorepo package-root resolution + soft skip", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ripple-mono-"));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("finds a nested package root when the workspace root has no manifest", () => {
    const pkg = join(root, "Aecci_main");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "aecci" }));
    writeFileSync(join(pkg, "tsconfig.json"), "{}");

    expect(findPackageRoots(root)).toContain(pkg);
    expect(resolvePrimaryPackageRoot(root)).toBe(pkg);
  });

  it("prefers nested package with tsconfig.app.json over sibling without", () => {
    const back = join(root, "Aecci_back");
    const main = join(root, "Aecci_main");
    mkdirSync(back, { recursive: true });
    mkdirSync(main, { recursive: true });
    writeFileSync(join(back, "package.json"), JSON.stringify({ name: "back" }));
    writeFileSync(join(back, "tsconfig.json"), "{}");
    writeFileSync(join(main, "package.json"), JSON.stringify({ name: "main" }));
    writeFileSync(join(main, "tsconfig.json"), JSON.stringify({ files: [] }));
    writeFileSync(join(main, "tsconfig.app.json"), "{}");
    mkdirSync(join(main, "src"), { recursive: true });

    const resolved = resolveAutomationProjectRoot(root);
    expect(resolved?.root).toBe(main);
    expect(resolved?.markersFound).toContain("tsconfig.app.json");
  });

  it("returns the root itself when it is already a package", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }));
    expect(findPackageRoots(root)).toEqual([root]);
  });

  it("soft-skips typecheck when no TS project is found (no throw)", async () => {
    const detailed = await runProjectTypecheckDetailed(root);
    expect(detailed.skipped).toBe(true);
    expect(detailed.diagnostics).toEqual([]);
    expect(detailed.report.toLowerCase()).toContain("skipped");
  });

  it("soft-skips lint when no eslint config is found (no throw)", async () => {
    const report = await runProjectLint(root);
    expect(report.toLowerCase()).toContain("skipped");
  });

  it("uses tsconfig.app.json when root tsconfig is a solution shell", () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "vite-app",
        scripts: { typecheck: "tsc --noEmit" },
      }),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }],
      }),
    );
    writeFileSync(
      join(root, "tsconfig.app.json"),
      JSON.stringify({
        compilerOptions: { strict: true, jsx: "react-jsx" },
        include: ["src"],
      }),
    );
    const cmd = detectTypecheckCommand(root);
    expect(cmd?.command).toContain("tsconfig.app.json");
  });

  it("proposes closing an unclosed JSX attribute quote", () => {
    const file = join(root, "broken.tsx");
    writeFileSync(
      file,
      [
        "export function Icon() {",
        "  return (",
        "    <circle",
        '      cx="18"',
        '      cy="18',
        '      r="14"',
        "    />",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    const proposals = proposeCodeRepairsFromDiagnostics(root, [
      {
        file: "broken.tsx",
        line: 6,
        column: 10,
        code: "TS1003",
        message: "Identifier expected.",
        source: "typescript",
      },
    ]);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]?.find).toContain('cy="18');
    expect(proposals[0]?.replace).toContain('cy="18"');
  });

  it("proposes closing unterminated string in JSX expression (TS1002)", () => {
    const file = join(root, "link.tsx");
    writeFileSync(
      file,
      [
        "export function Row() {",
        "  return (",
        '    <Link to={primaryAction.to || "#}>{primaryAction.label}</Link>',
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    const proposals = proposeCodeRepairsFromDiagnostics(root, [
      {
        file: "link.tsx",
        line: 3,
        column: 40,
        code: "TS1002",
        message: "Unterminated string literal.",
        source: "typescript",
      },
    ]);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]?.replace).toContain('|| "#"');
    expect(proposals[0]?.replace).toContain('"}');
  });

  it("does not glue English tails into extracted Windows paths", () => {
    const spoken =
      "Analyze why automation.typecheck runs from C:\\Users\\ANZAL\\Desktop\\DEAL ROOm instead of detecting Aecci_main as the actual TypeScript project root";
    const extracted = extractWindowsPath(spoken);
    expect(extracted).toBeTruthy();
    expect(extracted!.toLowerCase()).not.toContain("instead");
    expect(extracted!.toLowerCase()).not.toContain("detecting");
    expect(
      trimSpokenPathTail(
        "C:\\Users\\ANZAL\\Desktop\\DEAL ROOm instead of detecting Aecci_main",
      ),
    ).toMatch(/DEAL ROOm$/i);
  });
});
