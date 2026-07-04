import { openUrlWithTabResolver } from "../../../automation/browser/browserTabResolver.js";
import { buildBrowserSearchUrl } from "../../../automation/browser/parseBrowserWorkspaceSearch.js";
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

const BROWSER_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "browser.open_workspace",
      description:
        "Open a workspace URL in the active browser tab or default browser",
      category: "browser",
      priority: 95,
      cost: 4,
      idempotent: true,
      execution: { timeoutMs: 20_000 },
      argsSchema: {
        url: { type: "string", required: true },
        workspaceId: { type: "string" },
      },
      examples: ["open youtube", "open gmail"],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!url) {
        return { ok: false, error: "missing_arg:url" };
      }
      const workspaceId =
        typeof args.workspaceId === "string" ? args.workspaceId : undefined;
      try {
        const detail = await openUrlWithTabResolver(url, { workspaceId });
        return { ok: true, output: detail };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "open_workspace_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "browser.search_workspace",
      description:
        "Search the web in the active browser tab or default browser",
      category: "browser",
      priority: 94,
      cost: 4,
      idempotent: true,
      execution: { timeoutMs: 20_000 },
      argsSchema: {
        query: { type: "string", required: true },
        url: { type: "string" },
      },
      examples: ["search cats", "search for react hooks"],
    }),
    execute: async (_ctx, args): Promise<ToolResult> => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { ok: false, error: "missing_arg:query" };
      }
      const url =
        typeof args.url === "string" && args.url.trim()
          ? args.url.trim()
          : buildBrowserSearchUrl(query);
      try {
        const detail = await openUrlWithTabResolver(url, {
          workspaceId: "search",
        });
        return { ok: true, output: `Search ${query} — ${detail}` };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "search_workspace_failed",
        };
      }
    },
  },
];

let browserToolsRegistered = false;

export function registerPhase1BrowserTools(): void {
  for (const tool of BROWSER_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  browserToolsRegistered = true;
}

export function listPhase1BrowserToolNames(): string[] {
  return BROWSER_TOOLS.map((t) => t.definition.name);
}

export function resetPhase1BrowserToolsForTests(): void {
  browserToolsRegistered = false;
}

export function phase1BrowserToolsRegistered(): boolean {
  return browserToolsRegistered;
}
