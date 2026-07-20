/**
 * Desktop-side report synthesis: try backend LLM, else evidence-only partial.
 */
import { apiProjectAnalysis } from "../../services/api.js";
import { getAccessToken } from "../../auth/tokenStore.js";
import {
  buildEvidenceBundle,
} from "../evidence/normalizeEvidence.js";
import {
  buildEvidenceOnlyReport,
  renderReportMarkdown,
  validateSynthesizedReport,
} from "../reports/reportRenderer.js";
import {
  getReportSchema,
  type ReportSchemaId,
  type SynthesizedReport,
} from "../reports/reportSchemas.js";
import type { WorkflowContext } from "../planner/workflowTypes.js";
import {
  datedReportFilename,
  presentArtifact,
  writeArtifact,
} from "../../artifacts/artifactManager.js";

export type SynthesizeAndWriteResult = {
  ok: boolean;
  synthesisAvailable: boolean;
  synthesisSource: "llm" | "evidence_only";
  reportPath?: string;
  markdown?: string;
  findingCounts?: {
    confirmed: number;
    potential: number;
    informational: number;
    needs_review: number;
  };
  omittedEvidence?: number;
  error?: string;
  message: string;
};

function countFindings(report: SynthesizedReport) {
  const counts = {
    confirmed: 0,
    potential: 0,
    informational: 0,
    needs_review: 0,
  };
  for (const f of report.findings) {
    counts[f.status] += 1;
  }
  return counts;
}

async function tryLlmSynthesis(
  workflow: WorkflowContext,
  schemaId: ReportSchemaId,
): Promise<SynthesizedReport | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const { bundle } = buildEvidenceBundle(workflow);
  const res = await apiProjectAnalysis(token, {
    schemaId,
    intent: workflow.intent,
    userRequest: workflow.userRequest,
    project: workflow.project,
    evidence: bundle.evidence,
    omissions: bundle.omissions,
    stepSummaries: bundle.stepSummaries,
  });

  if (!res.success || !res.data?.report) return null;

  const report: SynthesizedReport = {
    schemaId,
    title: res.data.report.title,
    summary: res.data.report.summary,
    findings: res.data.report.findings,
    sections: res.data.report.sections ?? {},
    synthesisSource: "llm",
    synthesisAvailable: true,
    limitations: res.data.report.limitations ?? [],
  };

  const validation = validateSynthesizedReport(report);
  if (!validation.valid) return null;
  return report;
}

/**
 * Synthesize (LLM or evidence-only) and write Markdown under `.ripple/reports/`.
 * Default presentation is none — open only when workflow.presentation requests it.
 */
export async function synthesizeAndWriteReport(
  workflow: WorkflowContext,
): Promise<SynthesizeAndWriteResult> {
  const schemaId = (workflow.schemaId ?? getReportSchema("code-analysis")?.id) as
    | ReportSchemaId
    | undefined;
  if (!schemaId || !getReportSchema(schemaId)) {
    return {
      ok: false,
      synthesisAvailable: false,
      synthesisSource: "evidence_only",
      error: "unknown_schema",
      message: "Unknown report schema",
    };
  }

  const projectRoot = workflow.project?.rootPath?.trim();
  if (!projectRoot) {
    return {
      ok: false,
      synthesisAvailable: false,
      synthesisSource: "evidence_only",
      error: "artifact_project_root_required",
      message:
        "No active project root — open a project or say which folder to use before generating a report.",
    };
  }

  let report = await tryLlmSynthesis(workflow, schemaId);
  let synthesisAvailable = Boolean(report);
  if (!report) {
    report = buildEvidenceOnlyReport(workflow, schemaId);
    synthesisAvailable = false;
    workflow.status = "partial";
  }

  const schema = getReportSchema(schemaId)!;
  const markdown = renderReportMarkdown(report, workflow);
  const filename = datedReportFilename(schema.filenamePrefix);
  const written = writeArtifact({
    projectRoot,
    kind: "report",
    relativeName: filename,
    content: markdown,
    contentType: "text/markdown",
    schemaId,
    workflowId: workflow.workflowId,
    presentation: workflow.presentation,
  });

  if (!written.ok || !written.ref) {
    return {
      ok: false,
      synthesisAvailable,
      synthesisSource: report.synthesisSource,
      error: written.error ?? "artifact_write_failed",
      message: `Failed to write report: ${written.error ?? "unknown"}`,
    };
  }

  workflow.artifacts.push(written.ref);

  if (workflow.presentation !== "none") {
    await presentArtifact(written.ref, workflow.presentation);
  }

  const findingCounts = countFindings(report);
  const omitted =
    workflow.omissions.truncatedEvidence +
    workflow.omissions.skippedFiles;

  const statusLabel = synthesisAvailable ? "full" : "partial (synthesis unavailable)";
  return {
    ok: true,
    synthesisAvailable,
    synthesisSource: report.synthesisSource,
    reportPath: written.ref.path,
    markdown,
    findingCounts,
    omittedEvidence: omitted,
    message: `${schema.title} saved (${statusLabel}): ${written.ref.path} — confirmed=${findingCounts.confirmed}, potential=${findingCounts.potential}, informational=${findingCounts.informational + findingCounts.needs_review}, omitted=${omitted}`,
  };
}
