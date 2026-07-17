import { describe, expect, it } from "vitest";
import {
  executionPlanFromLlmPlan,
  getToolManifest,
  isKnownTool,
  parsedToPlanSteps,
  runL0Planner,
  runPlannerPipeline,
  shouldTryGptFallback,
  validatePlan,
  buildPlannerPromptContext,
  isPlannerGptCandidate,
  isMessagingAdapterCommand,
  buildExecutorPayload,
  executionPlanToPayload,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

function emptyWorld(overrides: Partial<WorldModel> = {}): WorldModel {
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
    ...overrides,
  };
}

describe("P8.5 tool registry", () => {
  it("exposes Wave 1 manifest", () => {
    const manifest = getToolManifest();
    expect(manifest.version).toBeTruthy();
    expect(manifest.categories.desktop).toContain("desktop.type_text");
    expect(isKnownTool("desktop.copy")).toBe(true);
    expect(isKnownTool("desktop.fake_tool")).toBe(false);
  });
});

describe("P8.5 L0 planner", () => {
  it("maps likho hello to desktop.type_text", () => {
    const l0 = runL0Planner("likho hello", "write hello", emptyWorld());
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.source).toBe("L0");
    expect(l0.plan.steps[0]?.tool).toBe("desktop.type_text");
    expect(l0.plan.steps[0]?.args.text).toBe("hello");
  });

  it("maps select all and copy to key sequence", () => {
    const l0 = runL0Planner(
      "select all and copy",
      "select all and copy",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.press_keys");
    expect(l0.plan.steps[0]?.args.sequence).toBeDefined();
  });

  it("maps select all and paste here to key sequence not workflow compound", () => {
    const world = emptyWorld({
      clipboard: { hasText: true, preview: "hello", length: 5 },
    });
    const l0 = runL0Planner(
      "Select all and paste here",
      "select all and paste here",
      world,
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.press_keys");
    const seq = l0.plan.steps[0]?.args.sequence as Array<{ value: string }>;
    expect(seq?.map((s) => s.value)).toEqual(["^a", "^v"]);
    expect(l0.plan.steps[0]?.args._desktopPayload).toBeUndefined();
  });

  it("maps highlight all to select_all tool", () => {
    const l0 = runL0Planner("highlight all", "highlight all", emptyWorld());
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.select_all");
  });

  it("maps delete all the text to editor clear not delete_file", () => {
    const l0 = runL0Planner(
      "Delete all the text",
      "delete all the text",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.press_keys");
    expect(l0.plan.steps[0]?.args._nativeIntent).toBeUndefined();
  });

  it("maps delete all the text and write to replaceAll type_text", () => {
    const l0 = runL0Planner(
      "Delete all the text and write ripple test",
      "delete all the text and write ripple test",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.type_text");
    expect(l0.plan.steps[0]?.args.text).toBe("ripple test");
    expect(l0.plan.steps[0]?.args.replaceAll).toBe(true);
  });

  it("maps copy to desktop.copy tool", () => {
    const steps = parsedToPlanSteps({ mode: "keys", keys: "^c" });
    expect(steps[0]?.tool).toBe("desktop.copy");
  });

  it("rejects paste when clipboard empty", () => {
    const l0 = runL0Planner("paste here", "paste here", emptyWorld());
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    const validation = validatePlan(l0.plan, emptyWorld(), "paste here");
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("clipboard_empty"))).toBe(
      true,
    );
  });

  it("maps open notepad and type hello to L0 compound executor steps", () => {
    const l0 = runL0Planner(
      "Open Notepad and type hello world",
      "open notepad and type hello world",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.source).toBe("L0");
    expect(l0.plan.steps).toHaveLength(2);
    expect(l0.plan.steps[0]?.tool).toBe("desktop.launch_app");
    expect(l0.plan.steps[1]?.tool).toBe("desktop.type_text");
    expect(l0.plan.steps[1]?.args.text).toBe("hello world");
    expect(l0.plan.steps[0]?.args._desktopPayload).toBeUndefined();
  });

  it("maps open notepad, type hello (comma) to L0 compound", () => {
    const l0 = runL0Planner(
      "Open notepad, type hello ripple",
      "open notepad, type hello ripple",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps).toHaveLength(2);
    expect(l0.plan.steps[0]?.tool).toBe("desktop.launch_app");
    expect(l0.plan.steps[1]?.tool).toBe("desktop.type_text");
    expect(l0.plan.steps[1]?.args.text).toBe("hello ripple");
  });

  it("maps open calculator and calculate multiplied by to compound type_text", () => {
    const l0 = runL0Planner(
      "Open Calculator and Calculate 465 Multiplied by 789",
      "open calculator and calculate 465 multiplied by 789",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps).toHaveLength(2);
    expect(l0.plan.steps[0]?.tool).toBe("desktop.launch_app");
    expect(l0.plan.steps[1]?.tool).toBe("desktop.type_text");
    expect(l0.plan.steps[1]?.args.text).toBe("465*789=");
  });

  it("maps type hello and save as notes.txt to type_text + save_file", () => {
    const l0 = runL0Planner(
      "type hello and save as notes.txt in downloads",
      "type hello and save as notes.txt in downloads",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps).toHaveLength(2);
    expect(l0.plan.steps[0]?.tool).toBe("desktop.type_text");
    expect(l0.plan.steps[1]?.tool).toBe("desktop.save_file");
    expect(l0.plan.steps[1]?.args.filename).toBe("notes.txt");
    expect(l0.plan.steps[1]?.args.folder).toBe("downloads");
  });

  it("maps open notepad write notes and save as three-step compound", () => {
    const l0 = runL0Planner(
      "open notepad, write meeting notes and save the file as meetingnotes.txt inside downloads",
      "open notepad, write meeting notes and save the file as meetingnotes.txt inside downloads",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps).toHaveLength(3);
    expect(l0.plan.steps[0]?.tool).toBe("desktop.launch_app");
    expect(l0.plan.steps[0]?.args.app).toBe("notepad");
    expect(l0.plan.steps[1]?.tool).toBe("desktop.type_text");
    expect(l0.plan.steps[1]?.args.text).toBe("meeting notes");
    expect(l0.plan.steps[2]?.tool).toBe("desktop.save_file");
    expect(l0.plan.steps[2]?.args.filename).toBe("meetingnotes.txt");
    expect(l0.plan.steps[2]?.args.folder).toBe("downloads");
  });

  it("maps type meeting notes comma save as two-step compound", () => {
    const l0 = runL0Planner(
      "Type meeting notes, save the file as meetingnotes.txt inside documents",
      "type meeting notes, save the file as meetingnotes.txt inside documents",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps).toHaveLength(2);
    expect(l0.plan.steps[0]?.tool).toBe("desktop.type_text");
    expect(l0.plan.steps[0]?.args.text).toBe("meeting notes");
    expect(l0.plan.steps[1]?.tool).toBe("desktop.save_file");
    expect(l0.plan.steps[1]?.args.filename).toBe("meetingnotes.txt");
    expect(l0.plan.steps[1]?.args.folder).toBe("documents");
  });

  it("does not collapse open notepad compound to launch_app only", () => {
    const l0 = runL0Planner(
      "open notepad, write meeting notes and save the file as meetingnotes.txt inside downloads",
      "open notepad, write meeting notes and save the file as meetingnotes.txt inside downloads",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps.length).toBeGreaterThan(1);
    expect(l0.plan.steps.some((s) => s.tool === "desktop.save_file")).toBe(true);
  });

  it("parses create new file server.js in cursor with app target", () => {
    const l0 = runL0Planner(
      "Create a new file, server.js in cursor",
      "create a new file, server.js in cursor",
      emptyWorld({
        foreground: {
          processName: "Cursor.exe",
          windowTitle: "QueryProvider.tsx - projectRipple - Cursor",
          hwnd: 1,
        },
      }),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    const write = l0.plan.steps.find((s) => s.tool === "filesystem.write_file");
    const save = l0.plan.steps.find((s) => s.tool === "desktop.save_file");
    expect(Boolean(write || save)).toBe(true);
    if (write) {
      expect(String(write.args.path)).toContain("server.js");
      expect(l0.plan.steps.some((s) => s.tool === "desktop.focus_window")).toBe(
        true,
      );
    }
    if (save) {
      expect(save.args.filename).toBe("server.js");
      expect(save.args.app).toBe("cursor");
    }
  });

  it("builds executor payload for create folder named inside documents", () => {
    const l0 = runL0Planner(
      "Open Notepad and type hello",
      "open notepad and type hello",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    const payload = executionPlanToPayload(l0.plan, "open notepad and type hello");
    expect(payload?.actions?.length).toBe(2);
    expect(payload?.intent).toBe("workflow");
  });

  it("maps list files in downloads to filesystem.list_directory", () => {
    const l0 = runL0Planner(
      "list files in downloads",
      "list files in downloads",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("filesystem.list_directory");
    expect(l0.plan.steps[0]?.args.parentFolder).toBe("downloads");
  });

  it("maps read clipboard to system.clipboard.read", () => {
    const l0 = runL0Planner(
      "read clipboard",
      "read clipboard",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("system.clipboard.read");
  });

  it("maps what window is active to desktop.get_active_window", () => {
    const l0 = runL0Planner(
      "What window is active",
      "what window is active",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.get_active_window");
  });

  it("maps which application currently I am using to desktop.get_active_window", () => {
    const l0 = runL0Planner(
      "Which application currently I am using",
      "which application currently i am using",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.get_active_window");
  });

  it("maps current workspace to live desktop workspace context", () => {
    const l0 = runL0Planner(
      "Explain my current workspace",
      "explain my current workspace",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.get_current_workspace");
  });

  it("maps copy hello to clipboard to system.clipboard.write", () => {
    const l0 = runL0Planner(
      "copy hello ripple to clipboard",
      "copy hello ripple to clipboard",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("system.clipboard.write");
    expect(l0.plan.steps[0]?.args.text).toBe("hello ripple");
  });

  it("maps delete notes in downloads to filesystem.delete", () => {
    const l0 = runL0Planner(
      "delete notes in downloads",
      "delete notes in downloads",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("filesystem.delete");
    expect(l0.plan.steps[0]?.args.sourceName).toBe("notes");
    expect(l0.plan.steps[0]?.args.parentFolder).toBe("downloads");
    expect(l0.plan.steps[0]?.args._desktopPayload).toBeUndefined();
  });

  it("maps create folder in downloads to filesystem.create_folder", () => {
    const l0 = runL0Planner(
      "create folder in downloads, name user",
      "create folder in downloads, name user",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("filesystem.create_folder");
    expect(l0.plan.steps[0]?.args.folderName).toBe("user");
    expect(l0.plan.steps[0]?.args.parentFolder).toBe("downloads");
  });

  it("maps open downloads to filesystem.open", () => {
    const l0 = runL0Planner(
      "open downloads",
      "open downloads",
      emptyWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("filesystem.open");
    expect(l0.plan.steps[0]?.args.folder).toBe("downloads");
  });
});

describe("P8.5 pipeline", () => {
  it("executes can you write hello via L0", () => {
    const result = runPlannerPipeline({
      command: "can you write hello",
      world: emptyWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.source).toBe("L0");
    expect(result.plan.steps[0]?.tool).toBe("desktop.type_text");
  });

  it("defers compose without body to LLM", () => {
    const pipeline = runPlannerPipeline({
      command: "Can you write a professional email",
      world: emptyWorld({ clipboard: { hasText: true, preview: "", length: 0 } }),
    });
    expect(pipeline.kind).toBe("defer");
    if (pipeline.kind === "defer") {
      expect(pipeline.reason).toBe("compose_needs_llm");
    }
  });

  it("defers unknown commands", () => {
    const result = runPlannerPipeline({
      command: "quantum flux capacitor engage",
      world: emptyWorld(),
    });
    expect(result.kind).toBe("defer");
    if (result.kind === "defer") {
      expect(result.reason).toBe("no_l0_match");
    }
  });

  it("defers unknown commands in web compose context to no_l0_match not web adapter", () => {
    const result = runPlannerPipeline({
      command: "quantum flux capacitor engage",
      world: emptyWorld({ browser: { surface: "whatsapp" } }),
    });
    expect(result.kind).toBe("defer");
    if (result.kind === "defer") {
      expect(result.reason).toBe("no_l0_match");
    }
  });
});

describe("P8.5 GPT bridge", () => {
  it("maps LLM type_text to ExecutionPlan", () => {
    const plan = executionPlanFromLlmPlan(
      {
        action: "type_text",
        entities: { text: "Dear Sir, I am writing to apply." },
        confidence: 0.91,
      },
      "Can you write a professional email",
      "can you write a professional email",
    );
    expect(plan?.source).toBe("GPT");
    expect(plan?.steps[0]?.tool).toBe("desktop.type_text");
    expect(plan?.steps[0]?.args.text).toContain("Dear Sir");
  });

  it("maps GPT multi-step steps array to ExecutionPlan", () => {
    const plan = executionPlanFromLlmPlan(
      {
        action: "none",
        entities: {},
        confidence: 0.88,
        steps: [
          { tool: "desktop.launch_app", args: { app: "notepad" }, reason: "open" },
          { tool: "desktop.type_text", args: { text: "hello" }, reason: "type" },
        ],
      },
      "open notepad and type hello",
      "open notepad and type hello",
    );
    expect(plan?.source).toBe("GPT");
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[0]?.tool).toBe("desktop.launch_app");
    expect(plan?.steps[1]?.tool).toBe("desktop.type_text");
  });

  it("enables GPT fallback for compose_needs_llm", () => {
    expect(shouldTryGptFallback("compose_needs_llm", "draft an email")).toBe(true);
    expect(shouldTryGptFallback("no_l0_match", "open HRMS")).toBe(true);
    expect(
      shouldTryGptFallback("no_l0_match", "Send notepad to Ahmed on WhatsApp"),
    ).toBe(false);
  });

  it("classifies planner GPT candidates", () => {
    expect(isPlannerGptCandidate("open HRMS")).toBe(true);
    expect(isMessagingAdapterCommand("message ahmed on instagram")).toBe(false);
    expect(isMessagingAdapterCommand("message ahmed on linkedin")).toBe(false);
  });

  it("builds planner prompt with manifest", () => {
    const ctx = buildPlannerPromptContext(emptyWorld(), {
      intentHint: "compose_text",
    });
    expect(ctx.manifestVersion).toBeTruthy();
    expect(ctx.systemPrompt).toContain("desktop.type_text");
    expect(ctx.intentHint).toBe("compose_text");
  });
});
