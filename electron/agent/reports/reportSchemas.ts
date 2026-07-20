export type ReportSchemaId =
  | "security-review"
  | "roadmap"
  | "dependency-audit"
  | "requirements-gap"
  | "production-comparison"
  | "code-analysis"
  | "compound-workflow";

export type ReportSectionId =
  | "summary"
  | "scope"
  | "confirmed_findings"
  | "potential_findings"
  | "informational"
  | "milestones"
  | "risks"
  | "remediation"
  | "gaps"
  | "comparison"
  | "limitations"
  | "provenance"
  | "next_steps";

export type ReportSchema = {
  id: ReportSchemaId;
  title: string;
  filenamePrefix: string;
  requiredSections: ReportSectionId[];
  allowedFindingCategories: string[];
};

export type SynthesizedFinding = {
  title: string;
  status: "confirmed" | "potential" | "informational" | "needs_review";
  confidence: number;
  severity?: "low" | "medium" | "high" | "critical";
  file?: string;
  line?: number;
  detail: string;
  evidenceIds?: string[];
};

export type SynthesizedReport = {
  schemaId: ReportSchemaId;
  title: string;
  summary: string;
  findings: SynthesizedFinding[];
  sections: Partial<Record<ReportSectionId, string>>;
  synthesisSource: "llm" | "evidence_only";
  synthesisAvailable: boolean;
  limitations?: string[];
};

export const REPORT_SCHEMAS: Record<ReportSchemaId, ReportSchema> = {
  "security-review": {
    id: "security-review",
    title: "Security Review",
    filenamePrefix: "security-review",
    requiredSections: [
      "summary",
      "scope",
      "confirmed_findings",
      "potential_findings",
      "remediation",
      "limitations",
      "provenance",
    ],
    allowedFindingCategories: ["auth", "secrets", "injection", "xss", "csrf", "dependency"],
  },
  roadmap: {
    id: "roadmap",
    title: "Project Roadmap",
    filenamePrefix: "roadmap",
    requiredSections: ["summary", "milestones", "risks", "next_steps", "provenance"],
    allowedFindingCategories: ["milestone", "risk", "dependency", "quality"],
  },
  "dependency-audit": {
    id: "dependency-audit",
    title: "Dependency Audit",
    filenamePrefix: "dependency-audit",
    requiredSections: [
      "summary",
      "confirmed_findings",
      "potential_findings",
      "remediation",
      "provenance",
    ],
    allowedFindingCategories: ["outdated", "vulnerability", "license"],
  },
  "requirements-gap": {
    id: "requirements-gap",
    title: "Requirements Gap Analysis",
    filenamePrefix: "requirements-gap",
    requiredSections: ["summary", "gaps", "next_steps", "provenance"],
    allowedFindingCategories: ["missing_requirement", "todo", "docs"],
  },
  "production-comparison": {
    id: "production-comparison",
    title: "Production Standards Comparison",
    filenamePrefix: "production-comparison",
    requiredSections: ["summary", "comparison", "gaps", "remediation", "provenance"],
    allowedFindingCategories: ["reliability", "security", "testing", "observability", "dx"],
  },
  "code-analysis": {
    id: "code-analysis",
    title: "Code Analysis",
    filenamePrefix: "code-analysis",
    requiredSections: [
      "summary",
      "confirmed_findings",
      "potential_findings",
      "next_steps",
      "provenance",
    ],
    allowedFindingCategories: ["bug", "quality", "typecheck", "structure"],
  },
  "compound-workflow": {
    id: "compound-workflow",
    title: "Issue Summary Note",
    filenamePrefix: "issue-note",
    requiredSections: ["summary", "confirmed_findings", "next_steps", "provenance"],
    allowedFindingCategories: ["issue", "summary"],
  },
};

export function getReportSchema(id: string): ReportSchema | null {
  return (REPORT_SCHEMAS as Record<string, ReportSchema>)[id] ?? null;
}

export function intentToSchemaId(intent: string): ReportSchemaId | null {
  switch (intent) {
    case "SECURITY_REVIEW":
      return "security-review";
    case "PROJECT_ROADMAP":
      return "roadmap";
    case "DEPENDENCY_AUDIT":
      return "dependency-audit";
    case "REQUIREMENTS_GAP":
      return "requirements-gap";
    case "COMPARE_TO_STANDARD":
      return "production-comparison";
    case "CODE_ANALYSIS":
      return "code-analysis";
    case "COMPOUND_WORKFLOW":
      return "compound-workflow";
    default:
      return null;
  }
}
