import { getFocusContext } from "../../../focus/focusContext.js";
import { getUserPreferences } from "../../../storage/userPreferences.js";
import {
  getActiveWorkspace,
  getLastProjectPath,
  getRecentContext,
} from "../../../storage/workContext.js";
import {
  applyCorrectionsToUtterance,
  listCorrections,
} from "../../../storage/voiceCorrections.js";
import { getUserGoals } from "../../../storage/userGoals.js";
import { getPendingCodeRepair } from "../codeRepairSession.js";
import { hasRegisteredTool, registerTool } from "../toolRegistry.js";
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
    since: "P8.5-P6",
    wave: 2,
    ...partial,
  };
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function wrap(fn: () => unknown): Promise<ToolResult> {
  try {
    const output = fn();
    return {
      ok: true,
      output: typeof output === "string" ? output : json(output),
    };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "context_tool_failed",
    };
  }
}

export function buildExecutionContextBundle(): Record<string, unknown> {
  const focus = getFocusContext();
  const prefs = getUserPreferences();
  const workspace = getActiveWorkspace();
  const recent = getRecentContext(5);
  const pending = getPendingCodeRepair();
  const goals = getUserGoals();

  return {
    capturedAt: Date.now(),
    user: {
      preferredIde: prefs.preferredIde,
      preferredBrowser: prefs.preferredBrowser,
      language: prefs.language,
    },
    workspace: workspace ?? {
      path: getLastProjectPath(),
      name: null,
      sticky: false,
    },
    focus: focus
      ? {
          processName: focus.processName,
          windowTitle: focus.windowTitle,
          hwnd: focus.hwnd,
        }
      : null,
    recent,
    pendingRepair: pending
      ? {
          projectPath: pending.projectPath,
          diagnosticCount: pending.diagnostics.length,
          autoApply: pending.autoApply,
        }
      : null,
    goals,
    correctionsSample: listCorrections(5),
  };
}

export function resolveUserIntentFromMemory(utterance: string): Record<string, unknown> {
  const raw = utterance.trim();
  const corrected = applyCorrectionsToUtterance(raw);
  const prefs = getUserPreferences();
  const workspace = getActiveWorkspace();
  const lastProject = getLastProjectPath();

  let intent:
    | "open_last_project"
    | "use_active_workspace"
    | "set_preference"
    | "unknown" = "unknown";

  if (/\b(?:my )?last project\b/i.test(corrected)) intent = "open_last_project";
  else if (workspace && /\b(?:typecheck|lint|audit|analyze|run tests?)\b/i.test(corrected)) {
    intent = "use_active_workspace";
  } else if (/\balways\b.+\b(?:cursor|vscode|chrome)\b/i.test(corrected)) {
    intent = "set_preference";
  }

  return {
    utterance: raw,
    correctedUtterance: corrected,
    intent,
    preferredIde: prefs.preferredIde,
    activeWorkspacePath: workspace?.path ?? null,
    lastProjectPath: lastProject,
  };
}

const CONTEXT_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "context.build_execution_context",
      description:
        "Build planner context from prefs, workspace, focus, recent work, and pending repair",
      category: "memory",
      risk: "low",
      priority: 85,
      cost: 3,
      idempotent: true,
      argsSchema: {},
      examples: ["build execution context"],
    }),
    execute: async () => wrap(() => buildExecutionContextBundle()),
  },
  {
    definition: def({
      name: "context.resolve_user_intent",
      description:
        "Map a short utterance to structured intent using memory (read-only)",
      category: "memory",
      risk: "low",
      priority: 84,
      cost: 3,
      idempotent: true,
      argsSchema: {
        utterance: { type: "string", required: true },
      },
      examples: ["resolve what I mean by open last project"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const utterance = str(args, "utterance");
        if (!utterance) throw new Error("missing_arg:utterance");
        return resolveUserIntentFromMemory(utterance);
      }),
  },
];

let registered = false;

export function registerPhase6ContextTools(): void {
  if (registered) return;
  for (const tool of CONTEXT_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) registerTool(tool);
  }
  registered = true;
}

export function resetPhase6ContextToolsForTests(): void {
  registered = false;
}

export function listPhase6ContextToolNames(): string[] {
  return CONTEXT_TOOLS.map((t) => t.definition.name);
}
