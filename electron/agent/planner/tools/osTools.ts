import {
  getAppProperties,
  getRunningApps,
  inspectWindow,
  runAppAsAdmin,
} from "../../../automation/desktop/osControlOps.js";
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
    since: "P8.5-P5.6",
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
      error: e instanceof Error ? e.message : "os_tool_failed",
    };
  }
}

const OS_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "os.run_as_admin",
      description: "Launch an installed app or EXE elevated (UAC)",
      category: "system",
      risk: "high",
      priority: 72,
      cost: 10,
      idempotent: false,
      argsSchema: {
        app: { type: "string", required: true },
        path: { type: "string" },
      },
      examples: ["run terminal as admin", "open powershell as administrator"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const target = str(args, "app") || str(args, "path");
        if (!target) throw new Error("missing_arg:app");
        return runAppAsAdmin(target);
      }),
  },
  {
    definition: def({
      name: "os.get_app_properties",
      description: "Read install path / version metadata for an app",
      category: "system",
      risk: "low",
      priority: 74,
      cost: 4,
      idempotent: true,
      argsSchema: {
        app: { type: "string", required: true },
      },
      examples: ["show Cursor properties", "what version is Chrome"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const app = str(args, "app");
        if (!app) throw new Error("missing_arg:app");
        return getAppProperties(app);
      }),
  },
  {
    definition: def({
      name: "os.get_running_apps",
      description: "List visible running app windows",
      category: "system",
      risk: "low",
      priority: 76,
      cost: 3,
      idempotent: true,
      argsSchema: {
        limit: { type: "number" },
      },
      examples: ["what apps are running", "list running windows"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => {
        const limit =
          typeof args.limit === "number" && Number.isFinite(args.limit)
            ? args.limit
            : 40;
        return getRunningApps(limit);
      }),
  },
  {
    definition: def({
      name: "window.inspect",
      description: "Inspect a visible window by title/process hint",
      category: "desktop",
      risk: "low",
      priority: 75,
      cost: 3,
      idempotent: true,
      argsSchema: {
        query: { type: "string" },
      },
      examples: ["inspect Cursor window", "inspect the notepad window"],
    }),
    execute: async (_ctx, args) =>
      wrap(() => inspectWindow(str(args, "query") || undefined)),
  },
];

let registered = false;

export function registerPhase56OsTools(): void {
  if (registered) return;
  for (const tool of OS_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) registerTool(tool);
  }
  registered = true;
}

export function resetPhase56OsToolsForTests(): void {
  registered = false;
}

export function listPhase56OsToolNames(): string[] {
  return OS_TOOLS.map((t) => t.definition.name);
}
