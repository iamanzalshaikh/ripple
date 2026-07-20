import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyArtifactGitignorePolicy,
  datedReportFilename,
  resolveArtifactPath,
  writeArtifact,
} from "../../artifacts/artifactManager.js";
import {
  boundOutputPreview,
  buildEvidenceBundle,
  clampSynthesizedStatus,
  normalizeToolOutputToEvidence,
  redactSecrets,
} from "../evidence/normalizeEvidence.js";
import {
  buildEvidenceOnlyReport,
  renderReportMarkdown,
  validateSynthesizedReport,
} from "../reports/reportRenderer.js";
import {
  REPORT_SCHEMAS,
  getReportSchema,
  intentToSchemaId,
} from "../reports/reportSchemas.js";
import { createWorkflowContext } from "../planner/workflowTypes.js";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import type { WorldModel } from "../types.js";
import { isKnownTool, TOOL_MANIFEST_VERSION } from "../planner/toolDefinitions.js";
import { listPhase5AiToolNames, registerPhase5AiTools, resetPhase5AiToolsForTests } from "../planner/tools/aiTools.js";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";

const stubWorld = (): WorldModel => ({
  capturedAt: 0,
  foreground: null,
  focusedField: null,
  focusContext: null,
  mouse: { x: 0, y: 0, windowUnderCursor: null },
  browser: { surface: null },
  clipboard: { hasText: false, preview: "", length: 0 },
  capabilities: {
    sidecarConnected: false,
    sendInput: true,
    uia: false,
    ocr: false,
  },
  activeGoal: null,
});

describe("evidence + report pipeline", () => {
  it("redacts secrets and bounds previews", () => {
    const { text, redacted } = redactSecrets(
      'password=supersecret token=sk-abcdefghijklmnopqrstuvwxyz012345',
    );
    expect(redacted).toBeGreaterThan(0);
    expect(text).toContain("[REDACTED]");
    expect(boundOutputPreview("x".repeat(5000)).length).toBeLessThan(2500);
  });

  it("keeps find_code keyword hits as potential, not confirmed", () => {
    const { items } = normalizeToolOutputToEvidence({
      tool: "automation.find_code",
      stepIndex: 2,
      ok: true,
      output:
        "C:\\proj\\admin\\page.tsx:18:const [password, setPassword] = useState('');",
    });
    expect(items[0]?.status).toBe("potential");
    expect(items[0]?.status).not.toBe("confirmed");
  });

  it("clamps LLM status so it cannot promote beyond local", () => {
    expect(clampSynthesizedStatus("potential", "confirmed")).toBe("potential");
    expect(clampSynthesizedStatus("confirmed", "potential")).toBe("potential");
  });

  it("registers every report schema and maps intents", () => {
    expect(Object.keys(REPORT_SCHEMAS).length).toBe(7);
    expect(intentToSchemaId("SECURITY_REVIEW")).toBe("security-review");
    expect(getReportSchema("roadmap")?.requiredSections).toContain("milestones");
  });

  it("renders evidence-only security report with confirmed/potential sections", () => {
    const wf = createWorkflowContext({
      intent: "SECURITY_REVIEW",
      schemaId: "security-review",
      userRequest: "Perform a security review",
      project: { name: "demo", rootPath: "C:\\demo" },
    });
    const { items } = normalizeToolOutputToEvidence({
      tool: "automation.analyze_codebase",
      stepIndex: 1,
      ok: true,
      output: "1. package.json\n   - No \"test\" script in package.json",
    });
    wf.evidence = items;
    const report = buildEvidenceOnlyReport(wf, "security-review");
    expect(report.synthesisAvailable).toBe(false);
    expect(validateSynthesizedReport(report).valid).toBe(true);
    const md = renderReportMarkdown(report, wf);
    expect(md).toMatch(/Confirmed findings/i);
    expect(md).toMatch(/Potential findings/i);
    expect(md).toMatch(/Synthesis unavailable|evidence-only/i);
  });

  it("builds a bounded evidence bundle", () => {
    const wf = createWorkflowContext({
      intent: "CODE_ANALYSIS",
      userRequest: "check code",
      project: { name: "x", rootPath: "C:\\x" },
    });
    wf.evidence = normalizeToolOutputToEvidence({
      tool: "automation.scan_project",
      stepIndex: 0,
      ok: true,
      output: "Scanning project: C:\\x\nTotal files: 3",
    }).items;
    const { bundle, charCount } = buildEvidenceBundle(wf);
    expect(bundle.evidence.length).toBeGreaterThan(0);
    expect(charCount).toBeLessThan(30_000);
  });
});

describe("artifact manager", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ripple-art-"));
  });
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("rejects path escape and writes reports atomically", () => {
    expect(resolveArtifactPath(dir, "report", "../escape.md").ok).toBe(false);
    const name = datedReportFilename("security-review");
    const written = writeArtifact({
      projectRoot: dir,
      kind: "report",
      relativeName: name,
      content: "# Security Review\n\nok\n",
      schemaId: "security-review",
      workflowId: "wf_test",
      presentation: "none",
    });
    expect(written.ok).toBe(true);
    expect(written.ref?.path).toContain(join(".ripple", "reports"));
    expect(readFileSync(written.ref!.path, "utf8")).toContain("Security Review");
  });

  it("gitignore ignores sessions/memory/executions but not reports", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules\n", "utf8");
    const r = applyArtifactGitignorePolicy(dir);
    expect(r.ok).toBe(true);
    const gi = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(gi).toContain(".ripple/sessions/");
    expect(gi).toContain(".ripple/memory/");
    expect(gi).toContain(".ripple/executions/");
    expect(gi).not.toMatch(/^\.ripple\/reports\/?$/m);
    // idempotent
    expect(applyArtifactGitignorePolicy(dir).changed).toBe(false);
  });
});

describe("semantic report wiring", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase5AiToolsForTests();
    registerPhase5AiTools();
  });

  it("plans synthesize_report for security and roadmap (no notepad template)", () => {
    for (const cmd of [
      "Perform a security review",
      "Create a roadmap to complete this project",
      "Analyze outdated and risky dependencies",
    ]) {
      const result = runPlannerPipeline({ command: cmd, world: stubWorld() });
      expect(result.kind).toBe("execute");
      if (result.kind !== "execute") continue;
      const tools = result.plan.steps.map((s) => s.tool);
      expect(tools).toContain("ai.synthesize_report");
      expect(tools).not.toContain("desktop.launch_app");
      expect(tools).not.toContain("desktop.type_text");
      expect(tools).not.toContain("ai.reason_about_task");
    }
  });

  it("registers ai.synthesize_report and bumps manifest", () => {
    expect(isKnownTool("ai.synthesize_report")).toBe(true);
    expect(listPhase5AiToolNames()).toContain("ai.synthesize_report");
    expect(TOOL_MANIFEST_VERSION).toBe("2.3.0");
  });
});
