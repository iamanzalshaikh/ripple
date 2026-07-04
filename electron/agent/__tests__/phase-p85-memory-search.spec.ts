import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRegisteredToolsForTests,
  getRegisteredTool,
} from "../planner/toolRegistry.js";
import {
  ensureP85ToolsRegistered,
  planEligibleForToolExecutor,
} from "../planner/toolExecutorBridge.js";
import { executeToolForExecutor } from "../planner/toolRegistry.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/desktop/intelligentSearch.js", () => ({
  resolveSmartSearch: vi.fn(async () => "C:\\Users\\Test\\resume.pdf"),
  openSmartSearchResult: vi.fn(async () => "Opened resume.pdf"),
}));

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, windowUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: false, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: true,
      sendInput: true,
      uia: true,
      ocr: true,
    },
    activeGoal: null,
  };
}

describe("P8.5 memory.search tool", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
    ensureP85ToolsRegistered();
  });

  afterEach(() => {
    clearRegisteredToolsForTests();
    vi.clearAllMocks();
  });

  it("registers memory.search with execute handler", () => {
    const tool = getRegisteredTool("memory.search");
    expect(tool?.definition.name).toBe("memory.search");
    expect(tool?.execute).toBeTypeOf("function");
  });

  it("memory.search plans are executor-eligible", () => {
    const eligible = planEligibleForToolExecutor({
      goal: "search resume",
      confidence: 0.9,
      steps: [
        {
          tool: "memory.search",
          args: { query: "my resume", utterance: "search my resume" },
          reason: "file_search",
        },
      ],
      rawUtterance: "search my resume",
      normalizedUtterance: "search my resume",
      source: "L0",
    });
    expect(eligible).toBe(true);
  });

  it("executes memory.search via smart search resolver", async () => {
    const { resolveSmartSearch, openSmartSearchResult } = await import(
      "../../automation/desktop/intelligentSearch.js"
    );

    const result = await executeToolForExecutor(
      "memory.search",
      {
        command: "search my resume",
        stepIndex: 0,
        execution: {
          world: stubWorld(),
          resolved: {},
          capabilities: {
            capturedAt: 0,
            manifestVersion: "1",
            registeredTools: ["memory.search"],
            native: { sendInput: true, uia: true, ocr: true, sidecarUp: true },
            extensions: {},
            permissions: {},
          },
          currentApp: null,
          focusedWindow: null,
          clipboard: { hasText: false, preview: "" },
          selection: null,
          recentTool: null,
          currentFolder: null,
          recentFile: null,
          lastStepOutput: null,
        },
      },
      { query: "my resume", utterance: "search my resume" },
    );

    expect(result.ok).toBe(true);
    expect(resolveSmartSearch).toHaveBeenCalled();
    expect(openSmartSearchResult).toHaveBeenCalledWith("C:\\Users\\Test\\resume.pdf");
    expect(result.output).toBe("Opened resume.pdf");
  });
});
