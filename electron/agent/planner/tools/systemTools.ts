import {
  readClipboardText,
  writeClipboardText,
} from "../../../automation/clipboard/clipboardService.js";
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
    since: "P8.5",
    wave: 1,
    risk: "low",
    ...partial,
  };
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

const SYSTEM_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "system.clipboard.read",
      description: "Read text from the system clipboard",
      category: "system",
      priority: 85,
      cost: 2,
      idempotent: true,
      permissions: ["clipboard"],
      requires: ["clipboard"],
      argsSchema: {},
      examples: ["read clipboard", "what is on my clipboard"],
    }),
    execute: async (): Promise<ToolResult> => {
      const text = readClipboardText();
      return { ok: true, output: text };
    },
  },
  {
    definition: def({
      name: "system.clipboard.write",
      description: "Write text to the system clipboard",
      category: "system",
      priority: 85,
      cost: 2,
      idempotent: false,
      permissions: ["clipboard"],
      requires: ["clipboard"],
      argsSchema: {
        text: { type: "string", required: true },
      },
      examples: ["copy hello to clipboard"],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const text = str(args, "text");
      if (!text) {
        return { ok: false, error: "missing_arg:text" };
      }
      writeClipboardText(text);
      return { ok: true, output: `Copied ${text.length} characters to clipboard` };
    },
  },
];

let phase1SystemRegistered = false;

export function registerPhase1SystemTools(): void {
  for (const tool of SYSTEM_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  phase1SystemRegistered = true;
}

export function listPhase1SystemToolNames(): string[] {
  return SYSTEM_TOOLS.map((t) => t.definition.name);
}

export function resetPhase1SystemToolsForTests(): void {
  phase1SystemRegistered = false;
}
