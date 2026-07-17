import {
  getUserPreferences,
  updateUserPreference,
  type PreferenceKey,
} from "../../../storage/userPreferences.js";
import {
  clearActiveWorkspace,
  clearRecentContext,
  getActiveWorkspace,
  getLastProjectPath,
  getRecentContext,
  pushRecentContext,
  setActiveWorkspace,
} from "../../../storage/workContext.js";
import {
  clearCorrections,
  learnCorrection,
  listCorrections,
} from "../../../storage/voiceCorrections.js";
import { rankChoices, recordUsage, type UsageKind } from "../../../storage/usageStats.js";
import {
  clearNamedWorkflows,
  clearUserGoals,
  getUserGoals,
  storeNamedWorkflow,
} from "../../../storage/userGoals.js";
import { resolveProjectPathDetailed } from "../../../automation/shell/projectResolver.js";
import {
  collapseDuplicateLeaf,
  resolveProjectIdentity,
} from "../../../automation/shell/projectIdentityResolver.js";
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

async function wrap(fn: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    const output = await fn();
    return {
      ok: true,
      output: typeof output === "string" ? output : json(output),
    };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "memory_tool_failed",
    };
  }
}

const PREF_KEYS = new Set<PreferenceKey>([
  "preferred_ide",
  "preferred_terminal",
  "preferred_browser",
  "default_projects_root",
  "confirm_strictness",
  "language",
]);

const MEMORY_INTEL_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "memory.get_user_preferences",
      description: "Read preferred IDE, browser, terminal, and related habits",
      category: "memory",
      risk: "low",
      priority: 82,
      cost: 2,
      idempotent: true,
      argsSchema: {},
      examples: ["what is my preferred IDE", "show my preferences"],
    }),
    execute: async () => wrap(() => getUserPreferences()),
  },
  {
    definition: def({
      name: "memory.update_preference",
      description: "Update a single user preference key",
      category: "memory",
      risk: "medium",
      priority: 80,
      cost: 3,
      idempotent: true,
      argsSchema: {
        key: { type: "string", required: true },
        value: { type: "string", required: true },
      },
      examples: ["always open projects in Cursor", "prefer Chrome"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const key = str(args, "key") as PreferenceKey;
        const value = str(args, "value");
        if (!PREF_KEYS.has(key)) return Promise.reject(new Error(`unknown_preference:${key}`));
        if (value === undefined || value === null) {
          return Promise.reject(new Error("missing_arg:value"));
        }
        return updateUserPreference(key, value);
      }),
  },
  {
    definition: def({
      name: "memory.get_recent_context",
      description: "List recent projects, files, and commands",
      category: "memory",
      risk: "low",
      priority: 81,
      cost: 2,
      idempotent: true,
      argsSchema: { limit: { type: "number" } },
      examples: ["what was I working on", "show recent context"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const limit =
          typeof args.limit === "number" && Number.isFinite(args.limit)
            ? args.limit
            : 10;
        return {
          recent: getRecentContext(limit),
          lastProject: getLastProjectPath(),
        };
      }),
  },
  {
    definition: def({
      name: "memory.set_active_workspace",
      description: "Set sticky active workspace for follow-up commands",
      category: "memory",
      risk: "medium",
      priority: 84,
      cost: 3,
      idempotent: true,
      argsSchema: {
        path: { type: "string" },
        projectHint: { type: "string" },
        name: { type: "string" },
        goal: { type: "string" },
      },
      examples: ["work on jkf", "set active workspace to HerRidez"],
    }),
    execute: async (_ctx, args) =>
      wrap(async () => {
        let path = str(args, "path");
        const hint = str(args, "projectHint") || str(args, "name");
        if (!path && hint) {
          // Full Windows path pasted as hint
          if (/^[A-Za-z]:[\\/]/.test(hint) || hint.includes("\\")) {
            const resolved = await resolveProjectPathDetailed({ path: hint });
            if (resolved.status === "resolved") {
              path = resolved.path;
            }
          }
        }
        if (!path && hint) {
          const identity = resolveProjectIdentity(hint);
          if (identity.status === "resolved") {
            path = identity.path;
            console.info(
              `[ripple-p85] project-identity auto path=${identity.path} score=${identity.score}`,
            );
          } else if (identity.status === "confirm") {
            throw new Error(
              `project_confirm:${identity.path}|${identity.question}`,
            );
          } else if (identity.status === "ambiguous") {
            const paths = identity.candidates.map((c) => c.path).join("||");
            throw new Error(
              `project_ambiguous:${paths}|${identity.question}`,
            );
          } else {
            // Fall back to legacy resolver (tests + sparse index).
            const resolved = await resolveProjectPathDetailed({
              projectHint: hint,
            });
            if (resolved.status === "resolved") {
              path = resolved.path;
            } else if (resolved.status === "ambiguous") {
              throw new Error(
                `project_ambiguous:${resolved.candidates.join("||")}|${resolved.question}`,
              );
            } else {
              throw new Error(`project_not_found:${identity.question}`);
            }
          }
        }
        if (!path) throw new Error("missing_arg:path_or_projectHint");
        path = collapseDuplicateLeaf(path);
        const ws = setActiveWorkspace({
          path,
          name: str(args, "name") || hint || undefined,
          goal: str(args, "goal") || undefined,
        });
        pushRecentContext({ projectPath: ws.path, command: "set_active_workspace" });
        recordUsage("path", ws.path);
        return {
          activeWorkspace: {
            name: ws.name,
            path: ws.path,
            confirmed: true,
            source: "user_confirmation",
            type: "project",
            lastUsed: ws.setAt,
          },
          ...ws,
        };
      }),
  },
  {
    definition: def({
      name: "memory.get_active_workspace",
      description: "Read the sticky active workspace",
      category: "memory",
      risk: "low",
      priority: 83,
      cost: 1,
      idempotent: true,
      argsSchema: {},
      examples: ["what project am I on", "get active workspace"],
    }),
    execute: async () =>
      wrap(() => getActiveWorkspace() ?? { active: false, path: getLastProjectPath() }),
  },
  {
    definition: def({
      name: "memory.rank_choices",
      description: "Rank app/path candidates by historical usage",
      category: "memory",
      risk: "low",
      priority: 78,
      cost: 2,
      idempotent: true,
      argsSchema: {
        kind: { type: "string", required: true },
        candidates: { type: "array", required: true },
      },
      examples: ["rank browser choices", "which app do I use most"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const kind = str(args, "kind") as UsageKind;
        if (!["app", "path", "workflow"].includes(kind)) {
          throw new Error("invalid_kind");
        }
        const candidates = Array.isArray(args.candidates)
          ? args.candidates.filter((c): c is string => typeof c === "string")
          : [];
        return rankChoices(kind, candidates);
      }),
  },
  {
    definition: def({
      name: "memory.learn_correction",
      description: "Remember spoken → canonical mapping (and optional path alias)",
      category: "memory",
      risk: "medium",
      priority: 79,
      cost: 3,
      idempotent: true,
      argsSchema: {
        spokenForm: { type: "string", required: true },
        canonicalForm: { type: "string", required: true },
        asAliasPath: { type: "string" },
      },
      examples: ["jkf means that folder", "her rides means HerRidez"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const spokenForm = str(args, "spokenForm");
        const canonicalForm = str(args, "canonicalForm");
        if (!spokenForm || !canonicalForm) {
          throw new Error("missing_arg:spokenForm_or_canonicalForm");
        }
        return learnCorrection({
          spokenForm,
          canonicalForm,
          asAliasPath: str(args, "asAliasPath") || undefined,
          source: "voice",
        });
      }),
  },
  {
    definition: def({
      name: "memory.store_workflow",
      description: "Store a named step recipe (does not execute)",
      category: "memory",
      risk: "medium",
      priority: 76,
      cost: 3,
      idempotent: true,
      argsSchema: {
        name: { type: "string", required: true },
        steps: { type: "array", required: true },
      },
      examples: ["remember this deploy workflow"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const name = str(args, "name");
        const steps = Array.isArray(args.steps) ? args.steps : [];
        if (!name) throw new Error("missing_arg:name");
        return storeNamedWorkflow(name, steps);
      }),
  },
  {
    definition: def({
      name: "memory.get_user_goals",
      description: "Read current user goals / milestone notes",
      category: "memory",
      risk: "low",
      priority: 75,
      cost: 2,
      idempotent: true,
      argsSchema: {},
      examples: ["what are my goals", "what should I do next on Ripple"],
    }),
    execute: async () => wrap(() => getUserGoals()),
  },
  {
    definition: def({
      name: "memory.forget_context",
      description: "Clear active workspace and/or temporary memory scopes",
      category: "memory",
      risk: "medium",
      priority: 74,
      cost: 3,
      idempotent: true,
      argsSchema: {
        scope: { type: "string" },
      },
      examples: ["forget current project", "forget workspace context"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const scope = (str(args, "scope") || "workspace").toLowerCase();
        if (scope === "all") {
          clearActiveWorkspace();
          clearRecentContext();
          clearCorrections();
          clearNamedWorkflows();
          clearUserGoals();
          return { cleared: "all" };
        }
        if (scope === "recent") {
          clearRecentContext();
          return { cleared: "recent" };
        }
        if (scope === "corrections") {
          clearCorrections();
          return { cleared: "corrections" };
        }
        clearActiveWorkspace();
        return { cleared: "workspace" };
      }),
  },
];

let registered = false;

export function registerPhase6MemoryIntelligenceTools(): void {
  if (registered) return;
  for (const tool of MEMORY_INTEL_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) registerTool(tool);
  }
  registered = true;
}

export function resetPhase6MemoryIntelligenceToolsForTests(): void {
  registered = false;
}

export function listPhase6MemoryToolNames(): string[] {
  return MEMORY_INTEL_TOOLS.map((t) => t.definition.name);
}