import {
  openSmartSearchResult,
  resolveSmartSearch,
} from "../../../automation/desktop/intelligentSearch.js";
import {
  parseSmartSearchCommand,
  type SmartSearchQuery,
} from "../../../automation/desktop/parseSmartSearchCommand.js";
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

function resolveSearchIntent(
  args: Record<string, unknown>,
): { query: SmartSearchQuery; label: string } | null {
  const utterance = str(args, "utterance");
  const queryText = str(args, "query");
  const candidates = [
    utterance,
    queryText,
    utterance ? `search ${utterance}` : "",
    queryText ? `search ${queryText}` : "",
    queryText ? `search for ${queryText}` : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const parsed = parseSmartSearchCommand(candidate);
    if (parsed) {
      return { query: parsed.query, label: parsed.label };
    }
  }

  if (!queryText) return null;
  return {
    query: { type: "latest_token", token: queryText },
    label: `search_${queryText.replace(/\s+/g, "_")}`,
  };
}

const MEMORY_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "memory.search",
      description: "Search semantic memory and file index, then open the best match",
      category: "memory",
      priority: 88,
      cost: 5,
      idempotent: true,
      execution: { timeoutMs: 30_000 },
      argsSchema: {
        query: { type: "string", required: true },
        utterance: { type: "string" },
      },
      examples: ["search my resume", "find latest pdf", "open yesterday's pdf"],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const resolved = resolveSearchIntent(args);
      if (!resolved) {
        return { ok: false, error: "missing_arg:query" };
      }

      try {
        const path = await resolveSmartSearch(resolved.query, resolved.label);
        const output = await openSmartSearchResult(path);
        return { ok: true, output, observation: { ok: true } };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "memory_search_failed",
        };
      }
    },
  },
];

let memoryToolsRegistered = false;

export function registerPhase1MemoryTools(): void {
  for (const tool of MEMORY_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  memoryToolsRegistered = true;
}

export function listPhase1MemoryToolNames(): string[] {
  return MEMORY_TOOLS.map((t) => t.definition.name);
}

export function resetPhase1MemoryToolsForTests(): void {
  memoryToolsRegistered = false;
}

export function phase1MemoryToolsRegistered(): boolean {
  return memoryToolsRegistered;
}
