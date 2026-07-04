import {
  type ExecutableToolDefinition,
  type RegisteredTool,
  type ToolContext,
  type ToolResult,
  isFrozenToolCategory,
} from "./toolTypes.js";

const tools = new Map<string, RegisteredTool>();
const registeredNames = new Set<string>();

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

/** Register a tool. Tool `name` is immutable — never rename; deprecate and add successor instead. */
export function registerTool(tool: RegisteredTool): void {
  const { name, category, deprecated, replacedBy } = tool.definition;

  if (!name.trim()) {
    throw new ToolRegistryError("tool name required");
  }
  if (!isFrozenToolCategory(category)) {
    throw new ToolRegistryError(
      `invalid category "${category}" — must be one of frozen allowlist (see toolTypes.FROZEN_TOOL_CATEGORIES)`,
    );
  }
  if (registeredNames.has(name)) {
    throw new ToolRegistryError(`tool already registered: ${name} (names are immutable)`);
  }
  if (deprecated && !replacedBy) {
    throw new ToolRegistryError(`deprecated tool ${name} must set replacedBy`);
  }

  registeredNames.add(name);
  tools.set(name, tool);
}

export function getRegisteredTool(name: string): RegisteredTool | undefined {
  return tools.get(name);
}

export function hasRegisteredTool(name: string): boolean {
  return tools.has(name);
}

export function listRegisteredTools(): ExecutableToolDefinition[] {
  return [...tools.values()].map((t) => t.definition);
}

export function clearRegisteredToolsForTests(): void {
  tools.clear();
  registeredNames.clear();
}

/**
 * Execute a registered tool handler.
 * @internal Only `toolExecutor.ts` may call this — do not import elsewhere.
 */
export async function executeToolForExecutor(
  name: string,
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return { ok: false, error: `unknown_tool:${name}` };
  }
  if (tool.definition.deprecated) {
    return {
      ok: false,
      error: `deprecated_tool:${name}${tool.definition.replacedBy ? `:use_${tool.definition.replacedBy}` : ""}`,
    };
  }
  try {
    return await tool.execute(ctx, args);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "tool_execute_failed";
    return { ok: false, error };
  }
}
