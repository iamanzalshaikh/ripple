import type { WorldModel } from "../types.js";
import type { ToolCategory } from "./planTypes.js";
import { getToolManifest } from "./toolDefinitions.js";

export type PlannerPromptContext = {
  manifestVersion: string;
  toolsJson: string;
  worldJson: string;
  systemPrompt: string;
  intentHint?: string;
};

function worldSummaryForPrompt(world: WorldModel): Record<string, unknown> {
  return {
    foreground: world.foreground
      ? {
          processName: world.foreground.processName,
          windowTitle: world.foreground.windowTitle,
        }
      : null,
    focused_field: world.focusedField
      ? {
          name: world.focusedField.name,
          controlType: world.focusedField.controlType,
        }
      : null,
    browser_surface: world.browser.surface,
    clipboard: {
      hasText: world.clipboard.hasText,
      previewLength: world.clipboard.length,
    },
    capabilities: world.capabilities,
    active_goal: world.activeGoal
      ? { summary: world.activeGoal.summary, stepIndex: world.activeGoal.stepIndex }
      : null,
  };
}

function filterCategories(
  categories: Record<string, string[]>,
  allowed?: ToolCategory[],
): Record<string, string[]> {
  if (!allowed?.length) return categories;
  const out: Record<string, string[]> = {};
  for (const cat of allowed) {
    if (categories[cat]?.length) out[cat] = categories[cat];
  }
  return out;
}

/** P8.5d — prompt contract for GPT planner (manifest + world only). */
export function buildPlannerPromptContext(
  world: WorldModel,
  options?: {
    categories?: ToolCategory[];
    intentHint?: string;
  },
): PlannerPromptContext {
  const manifest = getToolManifest();
  const filteredTools = options?.categories?.length
    ? manifest.tools.filter((t) => options.categories!.includes(t.category))
    : manifest.tools;

  const toolsJson = JSON.stringify(
    filteredTools.map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      args: t.argsSchema,
    })),
    null,
    2,
  );

  const worldJson = JSON.stringify(worldSummaryForPrompt(world), null, 2);
  const categories = filterCategories(manifest.categories, options?.categories);

  const systemPrompt = [
    "You are the planning brain of Ripple, a desktop voice assistant.",
    "You do not execute anything. Select tools from the manifest and return JSON matching ExecutionPlan.",
    "",
    "TOOLS (only these are legal):",
    toolsJson,
    "",
    "CURRENT WORLD STATE:",
    worldJson,
    "",
    "TOOL CATEGORIES:",
    JSON.stringify(categories),
    "",
    "RULES:",
    "- Only use tools listed above. Never invent a tool.",
    "- Return valid JSON: goal, confidence (0-1), steps[{tool, args, reason?}].",
    "- Single-step plans preferred unless the utterance clearly needs sequencing.",
    "- If unsure, set needsClarification:true and clarificationQuestion instead of guessing.",
    options?.intentHint ? `- Intent hint: ${options.intentHint}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    manifestVersion: manifest.version,
    toolsJson,
    worldJson,
    systemPrompt,
    intentHint: options?.intentHint,
  };
}

export function intentHintForDeferReason(reason: string): string | undefined {
  if (reason === "compose_needs_llm") return "compose_text";
  if (reason === "web_adapter_compose") return "compose_text";
  return undefined;
}

export function categoriesForDeferReason(
  reason: string,
): ToolCategory[] | undefined {
  if (reason === "compose_needs_llm" || reason === "web_adapter_compose") {
    return ["desktop", "communication"];
  }
  return undefined;
}
