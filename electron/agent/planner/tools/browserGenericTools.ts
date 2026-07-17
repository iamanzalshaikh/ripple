import { openUrlWithTabResolver } from "../../../automation/browser/browserTabResolver.js";
import { runBrowserGeneric } from "../../../automation/browser/browserGenericBridge.js";
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
    since: "P8.5-P5.3",
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

function bool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  return typeof v === "boolean" ? v : undefined;
}

function wrapBrowserResult(r: Awaited<ReturnType<typeof runBrowserGeneric>>): ToolResult {
  if (!r.ok) {
    return { ok: false, error: r.error ?? "browser_failed" };
  }
  const parts = [
    r.detail,
    r.text ? `text=${r.text.length} chars` : undefined,
    r.url ? `url=${r.url.slice(0, 80)}` : undefined,
    typeof r.x === "number" && typeof r.y === "number"
      ? `coords=${r.x},${r.y}`
      : undefined,
  ].filter(Boolean);
  return { ok: true, output: parts.join(" | ") || "browser OK" };
}

const BROWSER_GENERIC_TOOLS: RegisteredTool[] = [
  {
    definition: def({
      name: "browser.open_url",
      description: "Open or navigate to a URL in the active browser tab",
      category: "browser",
      risk: "low",
      priority: 80,
      cost: 5,
      idempotent: true,
      requires: ["browser"],
      argsSchema: {
        url: { type: "string", required: true },
        preferActiveTab: { type: "boolean" },
        workspaceId: { type: "string" },
      },
      examples: ["open github.com", "go to https://example.com"],
    }),
    execute: async (_ctx, args) => {
      const url = str(args, "url");
      if (!url) return { ok: false, error: "missing_arg:url" };
      try {
        const output = await openUrlWithTabResolver(url, {
          workspaceId: str(args, "workspaceId") || undefined,
          preferActiveTab: bool(args, "preferActiveTab"),
        });
        return { ok: true, output };
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "open_url_failed",
        };
      }
    },
  },
  {
    definition: def({
      name: "browser.extract_text",
      description: "Extract visible text from the active browser tab",
      category: "browser",
      risk: "low",
      priority: 75,
      cost: 6,
      idempotent: true,
      requires: ["browser"],
      argsSchema: {
        maxChars: { type: "number" },
      },
      examples: ["extract text from this page"],
    }),
    execute: async (_ctx, args) =>
      wrapBrowserResult(
        await runBrowserGeneric({
          action: "extract_text",
          maxChars: num(args, "maxChars"),
        }),
      ),
  },
  {
    definition: def({
      name: "browser.find_element",
      description: "Find a DOM element by selector, text, or aria-label",
      category: "browser",
      risk: "low",
      priority: 70,
      cost: 6,
      idempotent: true,
      requires: ["browser"],
      argsSchema: {
        selector: { type: "string" },
        text: { type: "string" },
        ariaLabel: { type: "string" },
        partial: { type: "boolean" },
      },
      examples: ["find the sign in button"],
    }),
    execute: async (_ctx, args) => {
      const selector = str(args, "selector");
      const text = str(args, "text");
      const ariaLabel = str(args, "ariaLabel");
      if (!selector && !text && !ariaLabel) {
        return { ok: false, error: "missing_arg:selector_or_text" };
      }
      return wrapBrowserResult(
        await runBrowserGeneric({
          action: "find_element",
          selector: selector || undefined,
          text: text || undefined,
          ariaLabel: ariaLabel || undefined,
          partial: bool(args, "partial"),
        }),
      );
    },
  },
  {
    definition: def({
      name: "browser.click",
      description: "Click an element or screen coordinates in the browser",
      category: "browser",
      risk: "medium",
      priority: 72,
      cost: 7,
      idempotent: false,
      requires: ["browser"],
      argsSchema: {
        selector: { type: "string" },
        text: { type: "string" },
        ariaLabel: { type: "string" },
        partial: { type: "boolean" },
        x: { type: "number" },
        y: { type: "number" },
      },
      examples: ["click the submit button"],
    }),
    execute: async (_ctx, args) =>
      wrapBrowserResult(
        await runBrowserGeneric({
          action: "click",
          selector: str(args, "selector") || undefined,
          text: str(args, "text") || undefined,
          ariaLabel: str(args, "ariaLabel") || undefined,
          partial: bool(args, "partial"),
          x: num(args, "x"),
          y: num(args, "y"),
        }),
      ),
  },
  {
    definition: def({
      name: "browser.type",
      description: "Type text into a focused or matched browser field",
      category: "browser",
      risk: "medium",
      priority: 72,
      cost: 7,
      idempotent: false,
      requires: ["browser"],
      argsSchema: {
        text: { type: "string", required: true },
        selector: { type: "string" },
      },
      examples: ["type hello in the search box"],
    }),
    execute: async (_ctx, args) => {
      const text = str(args, "text");
      if (!text) return { ok: false, error: "missing_arg:text" };
      return wrapBrowserResult(
        await runBrowserGeneric({
          action: "type",
          text,
          selector: str(args, "selector") || undefined,
        }),
      );
    },
  },
  {
    definition: def({
      name: "browser.scroll",
      description: "Scroll the active browser page or element",
      category: "browser",
      risk: "low",
      priority: 68,
      cost: 4,
      idempotent: true,
      requires: ["browser"],
      argsSchema: {
        deltaY: { type: "number" },
        amount: { type: "number" },
        selector: { type: "string" },
      },
      examples: ["scroll down on the page"],
    }),
    execute: async (_ctx, args) =>
      wrapBrowserResult(
        await runBrowserGeneric({
          action: "scroll",
          deltaY: num(args, "deltaY") ?? num(args, "amount"),
          selector: str(args, "selector") || undefined,
        }),
      ),
  },
];

let phase5BrowserRegistered = false;

export function registerPhase5BrowserTools(): void {
  for (const tool of BROWSER_GENERIC_TOOLS) {
    if (!hasRegisteredTool(tool.definition.name)) {
      registerTool(tool);
    }
  }
  phase5BrowserRegistered = true;
}

export function listPhase5BrowserToolNames(): string[] {
  return BROWSER_GENERIC_TOOLS.map((t) => t.definition.name);
}

export function resetPhase5BrowserToolsForTests(): void {
  phase5BrowserRegistered = false;
}

export function isPhase5BrowserToolsRegistered(): boolean {
  return phase5BrowserRegistered;
}
