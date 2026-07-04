import { describe, expect, it, beforeEach } from "vitest";
import { join } from "node:path";
import {
  clearRegisteredToolsForTests,
  executeToolForExecutor,
  registerTool,
  ToolRegistryError,
} from "../planner/toolRegistry.js";
import { executePlan } from "../planner/toolExecutor.js";
import {
  FROZEN_TOOL_CATEGORIES,
  type ExecutableToolDefinition,
} from "../planner/toolTypes.js";
import {
  clearPlannerMemoryForTests,
  lookupBinding,
  PLANNER_MEMORY_RECORD_MIN_CONFIDENCE,
  recordBinding,
} from "../planner/plannerMemory.js";
import {
  clearCapabilitySnapshotCacheForTests,
  getCachedCapabilitySnapshot,
  setCachedCapabilitySnapshot,
} from "../planner/capabilitySnapshotCache.js";

const stubDef = (
  overrides: Partial<ExecutableToolDefinition> = {},
): ExecutableToolDefinition => ({
  name: "desktop.type_text",
  version: "1.0.0",
  since: "P8.5",
  description: "Type text",
  category: "desktop",
  wave: 1,
  argsSchema: { text: { type: "string", required: true } },
  ...overrides,
});

describe("P8.5 Phase 0 — tool registry", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
  });

  it("enforces frozen tool categories", () => {
    expect(FROZEN_TOOL_CATEGORIES).toEqual([
      "desktop",
      "filesystem",
      "browser",
      "system",
      "memory",
      "communication",
      "automation",
      "ai",
    ]);

    expect(() =>
      registerTool({
        definition: stubDef({ name: "bad.tool", category: "windows" as "desktop" }),
        execute: async () => ({ ok: true }),
      }),
    ).toThrow(ToolRegistryError);
  });

  it("tool names are immutable after register", () => {
    registerTool({
      definition: stubDef({ name: "desktop.copy" }),
      execute: async () => ({ ok: true }),
    });

    expect(() =>
      registerTool({
        definition: stubDef({ name: "desktop.copy" }),
        execute: async () => ({ ok: true }),
      }),
    ).toThrow(/immutable/i);
  });

  it("deprecated tool requires replacedBy", () => {
    expect(() =>
      registerTool({
        definition: stubDef({
          name: "desktop.old_launch",
          deprecated: true,
        }),
        execute: async () => ({ ok: true }),
      }),
    ).toThrow(/replacedBy/i);
  });

  it("executeToolForExecutor runs registered handler", async () => {
    registerTool({
      definition: stubDef({ name: "desktop.echo" }),
      execute: async (_ctx, args) => ({
        ok: true,
        output: args.text,
      }),
    });

    const result = await executeToolForExecutor(
      "desktop.echo",
      {
        execution: {
          world: {
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
          },
          resolved: {},
          capabilities: {
            capturedAt: 0,
            manifestVersion: "0",
            registeredTools: [],
            native: { sendInput: true, uia: false, ocr: false, sidecarUp: false },
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
          lastStepOutput: undefined,
        },
        command: "test",
        stepIndex: 0,
      },
      { text: "hello" },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe("hello");
  });
});

describe("P8.5 Phase 0 — tool executor", () => {
  beforeEach(() => {
    clearRegisteredToolsForTests();
  });

  it("never sets replanned true (P9 only)", async () => {
    registerTool({
      definition: stubDef({ name: "desktop.noop" }),
      execute: async () => ({ ok: true }),
    });

    const summary = await executePlan(
      {
        goal: "noop",
        confidence: 1,
        steps: [{ tool: "desktop.noop", args: {} }],
        rawUtterance: "noop",
        normalizedUtterance: "noop",
        source: "L0",
      },
      {
        command: "noop",
        world: {
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
        },
      },
    );

    expect(summary.replanned).toBe(false);
    expect(summary.ok).toBe(true);
  });
});

describe("P8.5 Phase 0 — planner memory", () => {
  beforeEach(() => {
    clearPlannerMemoryForTests();
  });

  it("records only when confidence >= 0.9 and no user override", () => {
    expect(PLANNER_MEMORY_RECORD_MIN_CONFIDENCE).toBe(0.9);
    const notepad = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "notepad.exe",
    );

    expect(
      recordBinding({
        phrase: "hrms",
        kind: "app",
        target: notepad,
        confidence: 0.89,
      }),
    ).toBe(false);

    expect(
      recordBinding({
        phrase: "hrms",
        kind: "app",
        target: notepad,
        confidence: 0.95,
        userOverride: true,
      }),
    ).toBe(false);

    expect(
      recordBinding({
        phrase: "hrms",
        kind: "app",
        target: notepad,
        confidence: 0.95,
      }),
    ).toBe(true);

    expect(lookupBinding("HRMS")?.target).toBe(notepad);
  });
});

describe("P8.5 Phase 0 — capability snapshot cache", () => {
  beforeEach(() => {
    clearCapabilitySnapshotCacheForTests();
  });

  it("caches and returns snapshot", () => {
    const snap = {
      capturedAt: Date.now(),
      manifestVersion: "1.0.0",
      registeredTools: ["desktop.type_text"],
      native: { sendInput: true, uia: false, ocr: false, sidecarUp: true },
      extensions: { whatsapp: true },
      permissions: {},
    };
    setCachedCapabilitySnapshot(snap, 60_000);
    expect(getCachedCapabilitySnapshot()?.manifestVersion).toBe("1.0.0");
  });
});
