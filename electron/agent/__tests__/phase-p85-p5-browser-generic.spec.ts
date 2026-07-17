import { describe, expect, it, beforeEach, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import { executePlan } from "../planner/toolExecutor.js";
import { validatePlan } from "../planner/planValidator.js";
import {
  ensureP85ToolsRegistered,
  planEligibleForToolExecutor,
} from "../planner/toolExecutorBridge.js";
import {
  listPhase5BrowserToolNames,
  resetPhase5BrowserToolsForTests,
} from "../planner/tools/browserGenericTools.js";
import { tryL0BrowserGenericPlan } from "../planner/l0BrowserGenericPlanner.js";
import { parseOpenUrlCommand } from "../../automation/browser/parseOpenUrlCommand.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/browser/browserTabResolver.js", () => ({
  openUrlWithTabResolver: vi.fn(async (url: string) => `Navigated → ${url}`),
}));

vi.mock("../../automation/actions/insertText.js", () => ({
  runInsertText: vi.fn(async (data: { text?: string }) =>
    `typed ${data.text?.length ?? 0} chars`,
  ),
}));

vi.mock("../../automation/browser/browserGenericBridge.js", () => ({
  runBrowserGeneric: vi.fn(async (payload: { action: string; text?: string }) => {
    if (payload.action === "extract_text") {
      return {
        ok: true,
        text: "Article body text",
        url: "https://example.com/article",
        detail: "extracted via extension",
      };
    }
    if (payload.action === "type") {
      return { ok: true, detail: `typed ${payload.text?.length ?? 0} chars` };
    }
    if (payload.action === "find_element") {
      return { ok: true, x: 120, y: 340, width: 80, height: 24, detail: "found" };
    }
    return { ok: true, detail: `${payload.action} OK` };
  }),
}));

const stubWorld = (): WorldModel => ({
  capturedAt: 0,
  foreground: null,
  focusedField: null,
  focusContext: null,
  mouse: { x: 0, y: 0, windowUnderCursor: null },
  browser: { surface: null },
  clipboard: { hasText: false, preview: "", length: 0 },
  capabilities: {
    sidecarConnected: false,
    sendInput: true,
    uia: false,
    ocr: false,
  },
  activeGoal: null,
});

describe("P8.5-P5.3 browser generic tools", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    resetPhase5BrowserToolsForTests();
    ensureP85ToolsRegistered();
  });

  it("registers six generic browser tools", () => {
    const names = listPhase5BrowserToolNames();
    expect(names).toEqual([
      "browser.open_url",
      "browser.extract_text",
      "browser.find_element",
      "browser.click",
      "browser.type",
      "browser.scroll",
    ]);
  });

  it("parses open URL utterances and blocks native app names", () => {
    expect(parseOpenUrlCommand("open github.com")?.url).toBe("https://github.com");
    expect(parseOpenUrlCommand("go to https://example.com/path")?.url).toBe(
      "https://example.com/path",
    );
    expect(parseOpenUrlCommand("open cursor")).toBeNull();
    expect(parseOpenUrlCommand("open youtube")).toBeNull();
  });

  it("L0 plans browser.open_url for generic URL commands", () => {
    const l0 = tryL0BrowserGenericPlan("open github.com", "open github.com");
    expect(l0?.kind).toBe("plan");
    if (l0?.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("browser.open_url");
    expect(l0.plan.steps[0]?.args.url).toBe("https://github.com");
    const validation = validatePlan(l0.plan, stubWorld(), "open github.com");
    expect(validation.valid).toBe(true);
  });

  it("executes open_url via tab resolver (no CDP)", async () => {
    const plan = {
      goal: "open",
      confidence: 0.9,
      steps: [
        {
          tool: "browser.open_url",
          args: { url: "https://github.com" },
          reason: "test",
        },
      ],
      rawUtterance: "open github.com",
      normalizedUtterance: "open github.com",
      source: "test" as const,
    };
    expect(planEligibleForToolExecutor(plan)).toBe(true);
    const result = await executePlan(plan, {
      command: "open github.com",
      world: stubWorld(),
      plan,
    });
    expect(result.ok).toBe(true);
    expect(result.records[0]?.result.output).toMatch(/github\.com/i);
  });

  it("compound: open_url → extract_text → desktop.type_text", async () => {
    const plan = {
      goal: "copy article",
      confidence: 0.88,
      steps: [
        {
          tool: "browser.open_url",
          args: { url: "https://example.com/article" },
          reason: "open",
        },
        {
          tool: "browser.extract_text",
          args: {},
          reason: "extract",
        },
        {
          tool: "desktop.type_text",
          args: { text: "Article body text" },
          reason: "paste_summary",
        },
      ],
      rawUtterance: "test",
      normalizedUtterance: "test",
      source: "test" as const,
    };
    const validation = validatePlan(plan, stubWorld(), "test");
    expect(validation.valid).toBe(true);
    expect(planEligibleForToolExecutor(plan)).toBe(true);

    const { runBrowserGeneric } = await import(
      "../../automation/browser/browserGenericBridge.js"
    );
    const result = await executePlan(plan, {
      command: "test",
      world: stubWorld(),
      plan,
    });
    expect(result.ok).toBe(true);
    expect(runBrowserGeneric).toHaveBeenCalled();
    expect(result.records).toHaveLength(3);
  });
});
