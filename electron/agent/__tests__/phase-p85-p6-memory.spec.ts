import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeRippleDb,
  openRippleDbInMemoryForTests,
} from "../../storage/rippleDb.js";
import {
  clearUserPreferences,
  getUserPreferences,
  updateUserPreference,
} from "../../storage/userPreferences.js";
import {
  clearActiveWorkspace,
  getActiveWorkspace,
  setActiveWorkspace,
} from "../../storage/workContext.js";
import {
  applyCorrectionsToUtterance,
  clearCorrections,
  learnCorrection,
} from "../../storage/voiceCorrections.js";
import {
  clearUsageCounts,
  rankChoices,
  recordUsage,
} from "../../storage/usageStats.js";
import {
  listPhase6MemoryToolNames,
  registerPhase6MemoryIntelligenceTools,
  resetPhase6MemoryIntelligenceToolsForTests,
} from "../planner/tools/memoryIntelligenceTools.js";
import {
  listPhase6ContextToolNames,
  registerPhase6ContextTools,
  resetPhase6ContextToolsForTests,
} from "../planner/tools/contextTools.js";
import {
  clearRegisteredToolsForTests,
  executeToolForExecutor,
  getRegisteredTool,
} from "../planner/toolRegistry.js";
import { tryL0MemoryPlan } from "../planner/l0MemoryPlanner.js";
import { buildExecutorPayload } from "../planner/plannerExecutor.js";
import { ensureP85ToolsRegistered } from "../planner/toolExecutorBridge.js";
import { isKnownTool, TOOL_MANIFEST_VERSION } from "../planner/toolDefinitions.js";
import type { WorldModel } from "../types.js";
import type { ToolContext } from "../planner/toolTypes.js";

vi.mock("../../automation/desktop/aliasRegistry.js", () => ({
  addAlias: vi.fn(),
}));

vi.mock("../../focus/focusContext.js", () => ({
  getFocusContext: () => ({
    hwnd: 1,
    processName: "Cursor",
    windowTitle: "jkf",
    capturedAt: Date.now(),
    isGmail: false,
    isWhatsApp: false,
    isSlack: false,
    isNotion: false,
    isYouTube: false,
    isLinkedIn: false,
    isInstagram: false,
    isBrowser: false,
  }),
}));

vi.mock("../../automation/shell/projectResolver.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../automation/shell/projectResolver.js")
  >("../../automation/shell/projectResolver.js");
  return {
    ...actual,
    resolveProjectPathDetailed: vi.fn(async (args: {
      projectHint?: string;
      path?: string;
    }) => {
      if (args.path) return { status: "resolved" as const, path: args.path };
      if (args.projectHint?.toLowerCase().includes("jkf")) {
        return {
          status: "resolved" as const,
          path: "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )",
        };
      }
      if (args.projectHint?.toLowerCase().includes("school-management")) {
        return {
          status: "resolved" as const,
          path: "C:\\Users\\ANZAL\\Desktop\\school-management",
        };
      }
      return { status: "not_found" as const };
    }),
  };
});

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, deviceUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: false, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: false,
      sendInput: true,
      uia: false,
      ocr: true,
    },
    activeGoal: null,
  };
}

function stubCtx(command: string): ToolContext {
  return {
    command,
    stepIndex: 0,
    execution: {
      world: stubWorld(),
      resolved: {},
      capabilities: {
        capturedAt: 0,
        manifestVersion: "2.1.0",
        registeredTools: [],
        native: { sendInput: true, uia: false, ocr: true, sidecarUp: false },
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
  };
}

describe("P8.5-P6 memory + context", () => {
  beforeEach(() => {
    openRippleDbInMemoryForTests();
    clearRegisteredToolsForTests();
    resetPhase6MemoryIntelligenceToolsForTests();
    resetPhase6ContextToolsForTests();
    registerPhase6MemoryIntelligenceTools();
    registerPhase6ContextTools();
  });

  afterEach(() => {
    clearRegisteredToolsForTests();
    resetPhase6MemoryIntelligenceToolsForTests();
    resetPhase6ContextToolsForTests();
    closeRippleDb();
    vi.clearAllMocks();
  });

  it("registers 10 memory.* + 2 context.* tools and bumps manifest", () => {
    const memory = listPhase6MemoryToolNames();
    const context = listPhase6ContextToolNames();
    expect(memory).toHaveLength(10);
    expect(context).toEqual([
      "context.build_execution_context",
      "context.resolve_user_intent",
    ]);
    for (const name of [...memory, ...context]) {
      expect(getRegisteredTool(name)).toBeDefined();
      expect(isKnownTool(name)).toBe(true);
    }
    expect(TOOL_MANIFEST_VERSION).toBe("2.2.0");
  });

  it("stores preferred IDE preference", async () => {
    updateUserPreference("preferred_ide", "Cursor");
    expect(getUserPreferences().preferredIde).toBe("Cursor");

    const result = await executeToolForExecutor(
      "memory.update_preference",
      stubCtx("always use Cursor"),
      { key: "preferred_ide", value: "Cursor" },
    );
    expect(result.ok).toBe(true);
    expect(getUserPreferences().preferredIde).toBe("Cursor");
    clearUserPreferences();
  });

  it("sets sticky workspace via tool", async () => {
    const result = await executeToolForExecutor(
      "memory.set_active_workspace",
      stubCtx("work on jkf"),
      { projectHint: "jkf" },
    );
    expect(result.ok).toBe(true);
    expect(getActiveWorkspace()?.path).toContain("jkf");
    clearActiveWorkspace();
  });

  it("learns voice corrections and applies them", () => {
    learnCorrection({
      spokenForm: "her rides",
      canonicalForm: "HerRidez",
    });
    expect(applyCorrectionsToUtterance("open her rides please")).toContain(
      "HerRidez",
    );
    clearCorrections();
  });

  it("rank_choices prefers frequently used apps", () => {
    recordUsage("app", "chrome");
    recordUsage("app", "chrome");
    recordUsage("app", "edge");
    const ranked = rankChoices("app", ["edge", "chrome", "brave"]);
    expect(ranked[0]?.key).toBe("chrome");
    clearUsageCounts();
  });

  it("L0 routes always Cursor / work on / forget / last project", () => {
    setActiveWorkspace({
      path: "C:\\Users\\Test\\last-proj",
      name: "last-proj",
    });

    const pref = tryL0MemoryPlan(
      "Always open projects in Cursor",
      "always open projects in cursor",
    );
    expect(pref?.kind).toBe("plan");
    if (pref?.kind === "plan") {
      expect(pref.plan.steps[0]?.tool).toBe("memory.update_preference");
      expect(pref.plan.steps[0]?.args).toMatchObject({
        key: "preferred_ide",
        value: "Cursor",
      });
    }

    const work = tryL0MemoryPlan("Work on jkf", "work on jkf");
    expect(work?.kind).toBe("plan");
    if (work?.kind === "plan") {
      expect(work.plan.steps[0]?.tool).toBe("memory.set_active_workspace");
    }

    const last = tryL0MemoryPlan(
      "Open my last project",
      "open my last project",
    );
    expect(last?.kind).toBe("plan");
    if (last?.kind === "plan") {
      expect(last.plan.steps[0]?.tool).toBe("automation.open_project");
      expect(last.plan.steps[0]?.args.path).toContain("last-proj");
    }

    const forget = tryL0MemoryPlan(
      "Forget current project",
      "forget current project",
    );
    expect(forget?.kind).toBe("plan");
    if (forget?.kind === "plan") {
      expect(forget.plan.steps[0]?.tool).toBe("memory.forget_context");
    }

    clearActiveWorkspace();
  });

  it("L0 routes remember IDE, recall IDE, main project, learn means", () => {
    const rememberIde = tryL0MemoryPlan(
      "Remember I use Cursor as my IDE",
      "remember i use cursor as my ide",
    );
    expect(rememberIde?.kind).toBe("plan");
    if (rememberIde?.kind === "plan") {
      expect(rememberIde.plan.steps[0]?.tool).toBe("memory.update_preference");
      expect(rememberIde.plan.steps[0]?.args).toMatchObject({
        key: "preferred_ide",
        value: "Cursor",
      });
    }

    const whatIde = tryL0MemoryPlan(
      "What IDE do I use?",
      "what ide do i use",
    );
    expect(whatIde?.kind).toBe("plan");
    if (whatIde?.kind === "plan") {
      expect(whatIde.plan.steps[0]?.tool).toBe("memory.get_user_preferences");
    }

    const activeWorkspace = tryL0MemoryPlan(
      "Explain my active workspace",
      "explain my active workspace",
    );
    expect(activeWorkspace?.kind).toBe("plan");
    if (activeWorkspace?.kind === "plan") {
      expect(activeWorkspace.plan.steps[0]?.tool).toBe("memory.get_active_workspace");
    }

    const currentWorkspace = tryL0MemoryPlan(
      "Explain my current workspace",
      "explain my current workspace",
    );
    expect(currentWorkspace).toBeNull();

    const main = tryL0MemoryPlan(
      "Remember school-management as my main project",
      "remember school-management as my main project",
    );
    expect(main?.kind).toBe("plan");
    if (main?.kind === "plan") {
      expect(main.plan.steps[0]?.tool).toBe("memory.set_active_workspace");
      expect(main.plan.steps[0]?.args).toMatchObject({
        projectHint: "school-management",
      });
    }

    setActiveWorkspace({
      path: "C:\\Users\\Test\\school-management",
      name: "school-management",
    });
    const openMain = tryL0MemoryPlan(
      "Open my main project",
      "open my main project",
    );
    expect(openMain?.kind).toBe("plan");
    if (openMain?.kind === "plan") {
      expect(openMain.plan.steps[0]?.tool).toBe("automation.open_project");
      expect(openMain.plan.steps[0]?.args.path).toContain("school-management");
    }

    const learn = tryL0MemoryPlan(
      "Learn that AI project means AI-AGENT",
      "learn that ai project means ai-agent",
    );
    expect(learn?.kind).toBe("plan");
    if (learn?.kind === "plan") {
      expect(learn.plan.steps[0]?.tool).toBe("memory.learn_correction");
    }

    clearActiveWorkspace();
  });

  it("L0 routes what project was I working on / continue previous work", () => {
    setActiveWorkspace({
      path: "C:\\Users\\Test\\school-management",
      name: "school-management",
    });

    const recall = tryL0MemoryPlan(
      "What project was I working on",
      "what project was i working on",
    );
    expect(recall?.kind).toBe("plan");
    if (recall?.kind === "plan") {
      expect(recall.plan.steps[0]?.tool).toBe("memory.get_recent_context");
    }

    const continueWork = tryL0MemoryPlan(
      "Continue my previous work",
      "continue my previous work",
    );
    expect(continueWork?.kind).toBe("plan");
    if (continueWork?.kind === "plan") {
      expect(continueWork.plan.steps[0]?.tool).toBe("automation.open_project");
      expect(continueWork.plan.steps[0]?.args.path).toContain("school-management");
    }

    const previousWs = tryL0MemoryPlan(
      "Open my previous workspace",
      "open my previous workspace",
    );
    expect(previousWs?.kind).toBe("plan");
    if (previousWs?.kind === "plan") {
      expect(previousWs.plan.steps[0]?.tool).toBe("automation.open_project");
    }

    clearActiveWorkspace();
  });

  it("buildExecutorPayload bridges memory.* plans to tool executor", () => {
    ensureP85ToolsRegistered();
    const rememberIde = tryL0MemoryPlan(
      "Remember I use Cursor as my IDE",
      "remember i use cursor as my ide",
    );
    expect(rememberIde?.kind).toBe("plan");
    if (rememberIde?.kind !== "plan") return;

    const built = buildExecutorPayload(
      rememberIde.plan,
      "Remember I use Cursor as my IDE",
      stubWorld(),
    );
    expect(built.kind).toBe("executor");
    if (built.kind === "executor") {
      expect(built.payload.actions[0]?.data).toMatchObject({
        _p85Tool: "memory.update_preference",
        key: "preferred_ide",
        value: "Cursor",
      });
    }

    const whatIde = tryL0MemoryPlan(
      "What IDE do I use?",
      "what ide do i use",
    );
    expect(whatIde?.kind).toBe("plan");
    if (whatIde?.kind !== "plan") return;
    const builtRecall = buildExecutorPayload(
      whatIde.plan,
      "What IDE do I use?",
      stubWorld(),
    );
    expect(builtRecall.kind).toBe("executor");
  });

  it("builds execution context bundle", async () => {
    setActiveWorkspace({ path: "C:\\Users\\Test\\jkf", name: "jkf" });
    const result = await executeToolForExecutor(
      "context.build_execution_context",
      stubCtx("build context"),
      {},
    );
    expect(result.ok).toBe(true);
    const body = JSON.parse(String(result.output)) as {
      workspace: { path: string };
    };
    expect(body.workspace.path).toContain("jkf");
    clearActiveWorkspace();
  });
});
