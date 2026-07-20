import {
  detectElementOnScreen,
  explainActiveEditorFile,
  extractExecutionContext,
  generateActionPlanHeuristic,
  reasonAboutTaskHeuristic,
  summarizeScreen,
} from "../../../automation/ai/aiHelpers.js";
import {
  hasRegisteredTool,
  registerTool,
} from "../toolRegistry.js";
import type {
  ExecutableToolDefinition,
  RegisteredTool,
  ToolResult,
} from "../toolTypes.js";

function def(
  partial: Omit<ExecutableToolDefinition, "version" | "wave" | "since"> &
    Partial<Pick<ExecutableToolDefinition, "version" | "wave" | "since">>,
): ExecutableToolDefinition {
  return {
    version: "1.0.0",
    since: "P8.5-P5.5",
    wave: 2,
    ...partial,
  };
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function jsonOut(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function wrapAi(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const output = await fn();
    return {
      ok: true,
      output: typeof output === "string" ? output : jsonOut(output),
    };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "ai_tool_failed",
    };
  }
}

/**
 * P5.5 AI tools — read-only / draft-only.
 * `ai.generate_action_plan` MUST NOT call executePlan or mutating tools.
 */
const AI_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "ai.explain_active_editor_file",
      description:
        "Read the focused Cursor/VS Code file and return a senior-engineer explanation in Ripple UI (never types into the editor)",
      category: "ai",
      risk: "low",
      priority: 74,
      cost: 6,
      idempotent: true,
      requires: ["ai"],
      argsSchema: {
        style: { type: "string" },
      },
      examples: [
        "explain this code like a senior engineer",
        "explain the file I am working on",
      ],
    }),
    execute: async (_ctx, args) =>
      wrapAi(() =>
        explainActiveEditorFile({
          style: str(args, "style") || "senior_engineer",
        }),
      ),
  },
  {
    definition: def({
      name: "ai.summarize_screen",
      description: "OCR the active window and return a short screen summary",
      category: "ai",
      risk: "low",
      priority: 70,
      cost: 6,
      idempotent: true,
      requires: ["ai"],
      argsSchema: {
        hwnd: { type: "number" },
      },
      examples: ["what is on my screen", "summarize this window"],
    }),
    execute: async (_ctx, args) =>
      wrapAi(() => summarizeScreen({ hwnd: num(args, "hwnd") })),
  },
  {
    definition: def({
      name: "ai.extract_context",
      description:
        "Bundle foreground app, clipboard preview, pending repair, and optional screen summary",
      category: "ai",
      risk: "low",
      priority: 72,
      cost: 4,
      idempotent: true,
      requires: ["ai"],
      argsSchema: {
        includeScreen: { type: "boolean" },
      },
      examples: ["what context am I in", "extract my current context"],
    }),
    execute: async (_ctx, args) =>
      wrapAi(() =>
        extractExecutionContext({
          includeScreen: args.includeScreen !== false,
        }),
      ),
  },
  {
    definition: def({
      name: "ai.detect_element",
      description:
        "Locate a visible UI label via OCR and estimate click coordinates",
      category: "ai",
      risk: "low",
      priority: 68,
      cost: 7,
      idempotent: true,
      requires: ["ai"],
      argsSchema: {
        query: { type: "string", required: true },
        hwnd: { type: "number" },
      },
      examples: ["find the Save button on screen", "detect login field"],
    }),
    execute: async (_ctx, args) => {
      const query = str(args, "query");
      if (!query) return { ok: false, error: "missing_arg:query" };
      return wrapAi(() =>
        detectElementOnScreen({ query, hwnd: num(args, "hwnd") }),
      );
    },
  },
  {
    definition: def({
      name: "ai.reason_about_task",
      description:
        "Analyze a goal and suggest next steps (read-only — no side effects)",
      category: "ai",
      risk: "low",
      priority: 66,
      cost: 5,
      idempotent: true,
      requires: ["ai"],
      argsSchema: {
        goal: { type: "string", required: true },
      },
      examples: [
        "what should I do next to fix TypeScript errors",
        "reason about deploying this app",
      ],
    }),
    execute: async (_ctx, args) => {
      const goal = str(args, "goal");
      if (!goal) return { ok: false, error: "missing_arg:goal" };
      return wrapAi(async () => reasonAboutTaskHeuristic(goal));
    },
  },
  {
    definition: def({
      name: "ai.generate_action_plan",
      description:
        "Draft an ExecutionPlan for a goal (never executes — caller must validate and run)",
      category: "ai",
      risk: "low",
      priority: 64,
      cost: 8,
      idempotent: true,
      requires: ["ai"],
      argsSchema: {
        goal: { type: "string", required: true },
        utterance: { type: "string" },
      },
      examples: [
        "make a plan to audit my project",
        "generate an action plan for fixing errors",
      ],
    }),
    execute: async (ctx, args) => {
      const goal = str(args, "goal") || ctx.command;
      if (!goal.trim()) return { ok: false, error: "missing_arg:goal" };
      const utterance = str(args, "utterance") || ctx.command;
      // CRITICAL: draft only — do not import or call executePlan here.
      return wrapAi(async () => {
        const draft = generateActionPlanHeuristic(
          goal,
          utterance,
          utterance,
        );
        return {
          draft: true,
          notes: draft.notes,
          source: draft.source,
          plan: draft.plan,
        };
      });
    },
  },
  {
    definition: def({
      name: "ai.synthesize_report",
      description:
        "Synthesize evidence into a Markdown report under .ripple/reports (LLM when available; otherwise evidence-only partial)",
      category: "ai",
      risk: "low",
      priority: 62,
      cost: 10,
      idempotent: true,
      requires: ["ai"],
      argsSchema: {
        schemaId: { type: "string" },
        intent: { type: "string" },
        projectRoot: { type: "string" },
      },
      examples: [
        "save a security review report",
        "create a roadmap report in the project",
      ],
    }),
    execute: async (ctx, args) => {
      const workflow =
        (args._workflow as import("../workflowTypes.js").WorkflowContext | undefined) ??
        ctx.execution.workflow;
      if (!workflow) {
        return { ok: false, error: "missing_workflow_context" };
      }
      if (typeof args.schemaId === "string" && args.schemaId.trim()) {
        workflow.schemaId = args.schemaId.trim();
      }
      if (typeof args.intent === "string" && args.intent.trim()) {
        workflow.intent = args.intent.trim();
      }
      if (
        typeof args.presentation === "string" &&
        ["none", "inline", "open", "reveal", "ide"].includes(args.presentation)
      ) {
        workflow.presentation = args.presentation as
          | "none"
          | "inline"
          | "open"
          | "reveal"
          | "ide";
      }
      if (typeof args.projectRoot === "string" && args.projectRoot.trim()) {
        const root = args.projectRoot.trim();
        workflow.project = {
          name: root.split(/[/\\]/).filter(Boolean).pop() || "project",
          rootPath: root,
        };
      }
      if (!workflow.project?.rootPath && typeof ctx.execution.resolved.projectRoot === "string") {
        const root = ctx.execution.resolved.projectRoot.trim();
        if (root) {
          workflow.project = {
            name: root.split(/[/\\]/).filter(Boolean).pop() || "project",
            rootPath: root,
          };
        }
      }

      return wrapAi(async () => {
        const { synthesizeAndWriteReport } = await import(
          "../../reports/synthesizeReport.js"
        );
        const result = await synthesizeAndWriteReport(workflow);
        if (!result.ok) {
          throw new Error(result.error || result.message);
        }
        return result;
      });
    },
  },
];

let phase5AiRegistered = false;

export function registerPhase5AiTools(): void {
  if (phase5AiRegistered) return;
  for (const tool of AI_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  phase5AiRegistered = true;
}

export function resetPhase5AiToolsForTests(): void {
  phase5AiRegistered = false;
}

export function listPhase5AiToolNames(): string[] {
  return AI_TOOLS.map((t) => t.definition.name);
}
