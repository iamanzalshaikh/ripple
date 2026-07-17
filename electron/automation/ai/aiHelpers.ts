import { clipboard } from "electron";
import {
  getWindowRectCenter,
  screenshotOcrNative,
} from "../../native/win32Bridge.js";
import type { ScreenshotOcrResult } from "../../native/types.js";
import { getFocusContext } from "../../focus/focusContext.js";
import type { ExecutionPlan, PlanStep } from "../../agent/planner/planTypes.js";
import { isKnownTool } from "../../agent/planner/toolDefinitions.js";

export type ScreenSummary = {
  summary: string;
  ocrTextPreview: string;
  lineCount: number;
  width: number;
  height: number;
  hwnd?: number;
};

export type DetectedElement = {
  query: string;
  found: boolean;
  x: number;
  y: number;
  confidence: number;
  matchedLine?: string;
  method: "ocr_line_estimate" | "window_center_fallback";
};

export type ExecutionContextBundle = {
  capturedAt: number;
  foreground: {
    app?: string;
    title?: string;
    hwnd?: number;
  };
  clipboardPreview: string;
  clipboardLength: number;
  pendingRepair?: {
    projectPath: string;
    diagnosticCount: number;
    autoApply: boolean;
  };
  screenPreview?: string;
};

export type TaskReasoning = {
  goal: string;
  analysis: string;
  suggestedNextSteps: string[];
  risks: string[];
  confidence: number;
  source: "heuristic" | "gpt";
};

export type ActionPlanDraft = {
  plan: ExecutionPlan;
  notes: string;
  source: "heuristic" | "gpt";
};

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Capture OCR for the focused (or given) window. */
export async function captureScreenOcr(hwnd?: number): Promise<{
  ocr: ScreenshotOcrResult | null;
  hwnd?: number;
}> {
  const focus = getFocusContext();
  const targetHwnd = hwnd ?? focus?.hwnd;
  if (!targetHwnd) {
    const ocr = await screenshotOcrNative({});
    return { ocr, hwnd: undefined };
  }
  const ocr = await screenshotOcrNative({ hwnd: targetHwnd });
  return { ocr, hwnd: targetHwnd };
}

export async function summarizeScreen(args?: {
  hwnd?: number;
}): Promise<ScreenSummary> {
  const { ocr, hwnd } = await captureScreenOcr(args?.hwnd);
  if (!ocr?.text?.trim()) {
    return {
      summary: "No screen text could be read (OCR unavailable or empty).",
      ocrTextPreview: "",
      lineCount: 0,
      width: ocr?.width ?? 0,
      height: ocr?.height ?? 0,
      hwnd,
    };
  }

  const lines = ocr.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const head = lines.slice(0, 8);
  const summaryParts = [
    `Screen OCR: ${ocr.lineCount || lines.length} line(s)`,
    head.length ? `Top text: ${head.map((l) => truncate(l, 80)).join(" | ")}` : "",
  ].filter(Boolean);

  return {
    summary: summaryParts.join(". "),
    ocrTextPreview: truncate(ocr.text, 800),
    lineCount: ocr.lineCount || lines.length,
    width: ocr.width,
    height: ocr.height,
    hwnd,
  };
}

export async function extractExecutionContext(args?: {
  includeScreen?: boolean;
}): Promise<ExecutionContextBundle> {
  const focus = getFocusContext();
  let clip = "";
  try {
    clip = clipboard.readText() || "";
  } catch {
    clip = "";
  }

  const bundle: ExecutionContextBundle = {
    capturedAt: Date.now(),
    foreground: {
      app: focus?.processName,
      title: focus?.windowTitle,
      hwnd: focus?.hwnd,
    },
    clipboardPreview: truncate(clip, 200),
    clipboardLength: clip.length,
  };

  try {
    const { getPendingCodeRepair } = await import(
      "../../agent/planner/codeRepairSession.js"
    );
    const pending = getPendingCodeRepair();
    if (pending) {
      bundle.pendingRepair = {
        projectPath: pending.projectPath,
        diagnosticCount: pending.diagnostics.length,
        autoApply: pending.autoApply,
      };
    }
  } catch {
    /* optional */
  }

  if (args?.includeScreen !== false) {
    const screen = await summarizeScreen({ hwnd: focus?.hwnd });
    bundle.screenPreview = screen.summary;
  }

  return bundle;
}

/**
 * Estimate a click point for a visible label using OCR line order.
 * (Native OCR currently returns plain text — no per-word bboxes.)
 */
export async function detectElementOnScreen(args: {
  query: string;
  hwnd?: number;
}): Promise<DetectedElement> {
  const query = args.query.trim();
  const { ocr, hwnd } = await captureScreenOcr(args.hwnd);
  const center = hwnd
    ? await getWindowRectCenter(hwnd)
    : null;

  const fallbackX = center?.x ?? 400;
  const fallbackY = center?.y ?? 300;

  if (!query) {
    return {
      query,
      found: false,
      x: fallbackX,
      y: fallbackY,
      confidence: 0,
      method: "window_center_fallback",
    };
  }

  if (!ocr?.text?.trim() || !center) {
    return {
      query,
      found: false,
      x: fallbackX,
      y: fallbackY,
      confidence: 0.2,
      method: "window_center_fallback",
    };
  }

  const lines = ocr.text.split(/\r?\n/);
  const q = query.toLowerCase();
  let matchIndex = -1;
  let matchedLine: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.toLowerCase().includes(q)) {
      matchIndex = i;
      matchedLine = line.trim();
      break;
    }
  }

  if (matchIndex < 0) {
    return {
      query,
      found: false,
      x: fallbackX,
      y: fallbackY,
      confidence: 0.25,
      method: "window_center_fallback",
      matchedLine: undefined,
    };
  }

  const height = Math.max(ocr.height, 1);
  const lineCount = Math.max(lines.length, 1);
  const y =
    (center.y - height / 2) + ((matchIndex + 0.5) / lineCount) * height;

  return {
    query,
    found: true,
    x: Math.round(center.x),
    y: Math.round(y),
    confidence: 0.65,
    matchedLine,
    method: "ocr_line_estimate",
  };
}

export function reasonAboutTaskHeuristic(goal: string): TaskReasoning {
  const g = goal.trim();
  const lower = g.toLowerCase();
  const steps: string[] = [];
  const risks: string[] = [];

  if (/\b(fix|repair|patch|typecheck|lint|error)\b/i.test(g)) {
    steps.push("Open or focus the project in the preferred IDE");
    steps.push("Run TypeScript check and capture diagnostics");
    steps.push("Propose safe patches for high-confidence errors");
    steps.push("Re-run typecheck to confirm");
    risks.push("Auto-patches only cover safe patterns; complex logic needs review");
  } else if (/\b(email|gmail|message|whatsapp|send)\b/i.test(g)) {
    steps.push("Resolve the target contact / app surface");
    steps.push("Draft or paste message with confirmation");
    risks.push("Message send is high-risk — confirm before send");
  } else if (/\b(open|launch|start)\b/i.test(g)) {
    steps.push("Resolve app or folder from aliases / memory");
    steps.push("Launch or focus the target window");
  } else {
    steps.push("Build execution context (focus, clipboard, workspace)");
    steps.push("Generate a validated action plan");
    steps.push("Execute steps through the tool executor with safety checks");
  }

  if (/\bdelete|remove|deploy|push\b/i.test(lower)) {
    risks.push("Destructive or remote actions require explicit confirmation");
  }

  return {
    goal: g,
    analysis: `Heuristic analysis for: ${truncate(g, 120)}`,
    suggestedNextSteps: steps,
    risks,
    confidence: 0.72,
    source: "heuristic",
  };
}

const SAFE_DRAFT_TOOLS = new Set([
  "automation.open_project",
  "automation.scan_project",
  "automation.analyze_codebase",
  "automation.typecheck",
  "automation.lint",
  "automation.find_code",
  "automation.run_tests",
  "filesystem.search",
  "filesystem.read_file",
  "filesystem.list_directory",
  "filesystem.get_metadata",
  "desktop.get_active_window",
  "desktop.focus_window",
  "desktop.launch_app",
  "ai.summarize_screen",
  "ai.extract_context",
  "ai.detect_element",
  "ai.reason_about_task",
]);

/** Build a conservative draft plan from a natural-language goal (no GPT required). */
export function generateActionPlanHeuristic(
  goal: string,
  rawUtterance: string,
  normalizedUtterance: string,
): ActionPlanDraft {
  const g = goal.trim() || rawUtterance.trim();
  const lower = g.toLowerCase();
  const steps: PlanStep[] = [];

  steps.push({
    tool: "ai.extract_context",
    args: { includeScreen: true },
    reason: "ai_plan_context",
  });

  if (/\b(screen|what.*(see|on)|summarize.*(screen|window))\b/i.test(lower)) {
    steps.push({
      tool: "ai.summarize_screen",
      args: {},
      reason: "ai_plan_summarize",
    });
  }

  if (/\b(fix|repair|audit|typecheck|lint|error)\b/i.test(lower)) {
    steps.push({
      tool: "ai.reason_about_task",
      args: { goal: g },
      reason: "ai_plan_reason",
    });
  }

  if (steps.length === 1) {
    steps.push({
      tool: "ai.reason_about_task",
      args: { goal: g },
      reason: "ai_plan_reason_default",
    });
  }

  const filtered = steps.filter((s) => SAFE_DRAFT_TOOLS.has(s.tool) && isKnownTool(s.tool));

  return {
    plan: {
      goal: truncate(g, 160),
      confidence: 0.78,
      steps: filtered,
      rawUtterance,
      normalizedUtterance,
      source: "L0",
    },
    notes:
      "Heuristic draft only — mutating repair/deploy steps are omitted until confirmed via dedicated workflows.",
    source: "heuristic",
  };
}

/** Strip nested generate_action_plan and unknown tools from a draft. */
export function sanitizeActionPlanDraft(plan: ExecutionPlan): ExecutionPlan {
  const steps = plan.steps.filter(
    (s) =>
      s.tool !== "ai.generate_action_plan" &&
      isKnownTool(s.tool) &&
      SAFE_DRAFT_TOOLS.has(s.tool),
  );
  return { ...plan, steps };
}

export function parseActionPlanDraftOutput(
  output: unknown,
): ExecutionPlan | null {
  if (!output) return null;
  let obj: unknown = output;
  if (typeof output === "string") {
    try {
      obj = JSON.parse(output);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  const plan = (record.plan ?? record.draftPlan) as ExecutionPlan | undefined;
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) {
    return null;
  }
  return sanitizeActionPlanDraft(plan);
}

export type ActiveEditorExplanation = {
  summary: string;
  filePath: string | null;
  fileName: string | null;
  project: string | null;
  lineCount: number;
  exports: string[];
  functions: string[];
  imports: string[];
  style: string;
  truncated: boolean;
};

/** Read-only explain of the focused Cursor/VS Code file — result for Ripple UI, never INSERT_TEXT. */
export async function explainActiveEditorFile(opts?: {
  style?: string;
}): Promise<ActiveEditorExplanation> {
  const { resolveLiveIdeContext } = await import(
    "../../agent/planner/tools/desktopTools.js"
  );
  const { readFileSafe } = await import("../desktop/readFileSafe.js");
  const { basename } = await import("node:path");

  const ide = resolveLiveIdeContext();
  const style = (opts?.style ?? "senior_engineer").trim() || "senior_engineer";
  if (!ide?.filePath) {
    return {
      summary: ide
        ? `Cursor/VS Code is focused on ${ide.openedFile ?? "an unknown file"} in ${ide.projectName ?? "an unknown project"}, but the file path could not be resolved on disk. Focus the editor tab and try again.`
        : "No Cursor/VS Code editor is focused. Open a code file, then ask again.",
      filePath: null,
      fileName: ide?.openedFile ?? null,
      project: ide?.projectName ?? null,
      lineCount: 0,
      exports: [],
      functions: [],
      imports: [],
      style,
      truncated: false,
    };
  }

  const read = readFileSafe(ide.filePath, 80_000);
  const content = read.content;
  const lines = content.split(/\r?\n/);
  const imports = [
    ...content.matchAll(
      /^\s*import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*\{[^}]+\})?\s+from\s+["']([^"']+)["']/gm,
    ),
  ]
    .map((m) => m[1]!)
    .slice(0, 12);
  const exports = [
    ...content.matchAll(
      /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|type|interface|enum)\s+(\w+)/gm,
    ),
  ]
    .map((m) => m[1]!)
    .slice(0, 16);
  const functions = [
    ...content.matchAll(
      /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm,
    ),
    ...content.matchAll(
      /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm,
    ),
  ]
    .map((m) => m[1]!)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .slice(0, 16);

  const fileName = basename(ide.filePath);
  const preview = lines
    .slice(0, 8)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .join("\n");

  const bullets = [
    `File: ${fileName}`,
    ide.projectName ? `Project: ${ide.projectName}` : null,
    `Path: ${ide.filePath}`,
    `Size: ${lines.length} lines${read.truncated ? " (read capped)" : ""}`,
    exports.length ? `Key exports: ${exports.join(", ")}` : "No named exports detected at top level.",
    functions.length
      ? `Main functions/closures: ${functions.join(", ")}`
      : "No top-level function declarations detected.",
    imports.length
      ? `Depends on: ${imports.slice(0, 8).join(", ")}`
      : "Few/no external imports detected.",
    "",
    "Senior-engineer read:",
    `This looks like ${guessFileRole(fileName, content)}.`,
    exports.length || functions.length
      ? `Start by reading ${exports[0] ?? functions[0]} — that is the primary surface area.`
      : "Scan from the top for the main control-flow entry, then follow call sites.",
    "Watch for side effects (I/O, focus/window mutations, network) before refactoring.",
    preview ? `\nOpening lines:\n${preview}` : null,
  ].filter(Boolean);

  return {
    summary: bullets.join("\n"),
    filePath: ide.filePath,
    fileName,
    project: ide.projectName,
    lineCount: lines.length,
    exports,
    functions,
    imports,
    style,
    truncated: read.truncated,
  };
}

function guessFileRole(fileName: string, content: string): string {
  const lower = fileName.toLowerCase();
  if (/planner|l0|router/.test(lower)) return "a planner/routing module that maps utterances to tools";
  if (/tool/.test(lower)) return "a tool registration/execution module";
  if (/test|spec/.test(lower)) return "a test/spec file";
  if (/component|page|tsx/.test(lower)) return "a UI component/page";
  if (/ocr|native|win32/.test(lower) || /PrintWindow|BitBlt/.test(content))
    return "a native/desktop capture or OS-bridge module";
  if (/export\s+(?:async\s+)?function|export\s+const/.test(content))
    return "a TypeScript module with exported APIs";
  return "an application source file";
}
