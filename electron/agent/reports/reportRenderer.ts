import type { EvidenceItem, WorkflowContext } from "../planner/workflowTypes.js";
import {
  getReportSchema,
  type ReportSchemaId,
  type SynthesizedFinding,
  type SynthesizedReport,
} from "./reportSchemas.js";

function findingsByStatus(
  findings: SynthesizedFinding[],
  status: SynthesizedFinding["status"],
): SynthesizedFinding[] {
  return findings.filter((f) => f.status === status);
}

function renderFindingList(findings: SynthesizedFinding[], emptyLabel: string): string {
  if (!findings.length) return `_None — ${emptyLabel}_\n`;
  return findings
    .map((f, i) => {
      const loc = f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ""}\`)` : "";
      const sev = f.severity ? ` · ${f.severity}` : "";
      const evidence = f.evidenceIds?.length
        ? `\n   - evidence: ${f.evidenceIds.join(", ")}`
        : "";
      return `${i + 1}. **${f.title}**${loc}${sev}\n   - confidence: ${f.confidence.toFixed(2)}\n   - ${f.detail}${evidence}`;
    })
    .join("\n\n");
}

function evidenceToFindings(evidence: EvidenceItem[]): SynthesizedFinding[] {
  return evidence.map((e) => ({
    title: e.title,
    status: e.status,
    confidence: e.confidence,
    severity: e.severity,
    file: e.file,
    line: e.line,
    detail: e.detail,
    evidenceIds: [e.id],
  }));
}

/** Build an honest evidence-only report when LLM synthesis is unavailable. */
export function buildEvidenceOnlyReport(
  workflow: WorkflowContext,
  schemaId: ReportSchemaId,
): SynthesizedReport {
  const schema = getReportSchema(schemaId)!;
  const findings = evidenceToFindings(workflow.evidence);
  return {
    schemaId,
    title: schema.title,
    summary:
      "Synthesis unavailable. This report lists locally collected evidence only — do not treat keyword matches as confirmed vulnerabilities.",
    findings,
    sections: {
      summary:
        "Backend synthesis was unavailable or failed. Findings below are copied from local tool evidence with status preserved.",
      limitations:
        "No LLM synthesis. Keyword search hits remain potential. Confirmed items come only from deterministic local analyzers/commands.",
      provenance: `workflow=${workflow.workflowId}; project=${workflow.project?.rootPath ?? "unknown"}; evidence=${workflow.evidence.length}`,
    },
    synthesisSource: "evidence_only",
    synthesisAvailable: false,
    limitations: [
      "Synthesis unavailable",
      ...workflow.omissions.reasons.slice(0, 8),
    ],
  };
}

export function validateSynthesizedReport(
  report: SynthesizedReport,
): { valid: boolean; errors: string[] } {
  const schema = getReportSchema(report.schemaId);
  const errors: string[] = [];
  if (!schema) errors.push("unknown_schema");
  if (!report.title?.trim()) errors.push("missing_title");
  if (!report.summary?.trim()) errors.push("missing_summary");
  if (!Array.isArray(report.findings)) errors.push("missing_findings");
  return { valid: errors.length === 0, errors };
}

/** Generic Markdown renderer driven by the schema registry. */
export function renderReportMarkdown(
  report: SynthesizedReport,
  workflow: WorkflowContext,
): string {
  const schema = getReportSchema(report.schemaId);
  const title = report.title || schema?.title || "Ripple Report";
  const confirmed = findingsByStatus(report.findings, "confirmed");
  const potential = findingsByStatus(report.findings, "potential");
  const informational = [
    ...findingsByStatus(report.findings, "informational"),
    ...findingsByStatus(report.findings, "needs_review"),
  ];

  const lines: string[] = [
    `# ${title}`,
    "",
    `**Project:** ${workflow.project?.name ?? "unknown"} (\`${workflow.project?.rootPath ?? "n/a"}\`)`,
    `**Intent:** ${workflow.intent}`,
    `**Generated:** ${new Date().toISOString()}`,
    `**Synthesis:** ${report.synthesisAvailable ? report.synthesisSource : "unavailable (evidence-only)"}`,
    `**Workflow:** \`${workflow.workflowId}\``,
    "",
    "## Summary",
    "",
    report.sections.summary?.trim() || report.summary,
    "",
  ];

  if (schema?.requiredSections.includes("scope") || report.sections.scope) {
    lines.push("## Scope", "", report.sections.scope?.trim() || `Tools run: ${workflow.steps.map((s) => s.tool).join(", ") || "n/a"}`, "");
  }

  if (schema?.id === "roadmap" || report.sections.milestones) {
    lines.push(
      "## Milestones",
      "",
      report.sections.milestones?.trim() ||
        renderFindingList(confirmed.length ? confirmed : informational, "no milestones extracted"),
      "",
    );
  }

  if (schema?.requiredSections.includes("confirmed_findings") || confirmed.length) {
    lines.push(
      "## Confirmed findings",
      "",
      renderFindingList(confirmed, "no confirmed findings"),
      "",
    );
  }

  if (schema?.requiredSections.includes("potential_findings") || potential.length) {
    lines.push(
      "## Potential findings (needs review)",
      "",
      renderFindingList(potential, "no potential findings"),
      "",
    );
  }

  if (schema?.requiredSections.includes("informational") || informational.length) {
    lines.push(
      "## Informational",
      "",
      renderFindingList(informational, "none"),
      "",
    );
  }

  if (report.sections.gaps) {
    lines.push("## Gaps", "", report.sections.gaps.trim(), "");
  }
  if (report.sections.comparison) {
    lines.push("## Comparison", "", report.sections.comparison.trim(), "");
  }
  if (report.sections.risks) {
    lines.push("## Risks", "", report.sections.risks.trim(), "");
  }
  if (report.sections.remediation || schema?.requiredSections.includes("remediation")) {
    lines.push(
      "## Remediation",
      "",
      report.sections.remediation?.trim() || "_Review potential findings and prioritize high-severity items._",
      "",
    );
  }
  if (report.sections.next_steps || schema?.requiredSections.includes("next_steps")) {
    lines.push(
      "## Next steps",
      "",
      report.sections.next_steps?.trim() || "_Open confirmed findings and decide which to fix first._",
      "",
    );
  }

  lines.push(
    "## Limitations",
    "",
    (report.limitations ?? []).concat(report.sections.limitations ? [report.sections.limitations] : []).join("\n- ")
      ? `- ${(report.limitations ?? []).concat(report.sections.limitations ? [report.sections.limitations] : []).join("\n- ")}`
      : "- Keyword matches are not confirmed vulnerabilities.",
    "",
    "## Provenance",
    "",
    report.sections.provenance?.trim() ||
      `workflow=${workflow.workflowId}; evidence=${workflow.evidence.length}; omissions=${JSON.stringify(workflow.omissions)}`,
    "",
    "---",
    "_Generated by Ripple Semantic Report Pipeline_",
    "",
  );

  return lines.join("\n");
}
