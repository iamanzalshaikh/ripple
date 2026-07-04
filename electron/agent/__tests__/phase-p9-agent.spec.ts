import { describe, expect, it } from "vitest";
import {
  extractDirectTypingText,
  normalizeVoiceStutter,
  parseCalculatorInput,
  parseDesktopInputFallback,
} from "../parseDesktopInput.js";
import { isRippleApplicationWindow } from "../../focus/focusContext.js";
import { tryAgentCompoundCommand } from "../agentOrchestrator.js";
import { nativeIntentFromLlmPlan } from "../../automation/voice/nlu/intentFromLlm.js";
import { planUniversalIntent } from "../universalPlanner.js";
import {
  parseGoalControlCommand,
  startGoal,
  getActiveGoal,
  completeGoal,
} from "../goalManager.js";

describe("P9 focus / ripple window detection", () => {
  it("does not treat Cursor editor titles with projectRipple as Ripple app", () => {
    expect(
      isRippleApplicationWindow(
        "Cursor",
        "FINAL_IMPLEMENTATION_PLAN.md - projectRipple",
      ),
    ).toBe(false);
  });

  it("still detects Ripple electron windows", () => {
    expect(isRippleApplicationWindow("electron", "Ripple Voice")).toBe(true);
    expect(isRippleApplicationWindow("ripple-desktop", "")).toBe(true);
  });
});

describe("P9 parseDesktopInput", () => {
  it("parses write/put/say synonyms", () => {
    expect(extractDirectTypingText("write hello world")?.toLowerCase()).toBe(
      "hello world",
    );
    expect(extractDirectTypingText("put test here")?.toLowerCase()).toBe("test");
    expect(extractDirectTypingText("say ripple works")?.toLowerCase()).toBe(
      "ripple works",
    );
  });

  it("parses roman Urdu typing", () => {
    expect(extractDirectTypingText("likho salam")?.toLowerCase()).toBe("salam");
    expect(extractDirectTypingText("type karo hello")?.toLowerCase()).toBe(
      "hello",
    );
  });

  it("parses edit keys", () => {
    expect(parseDesktopInputFallback("select all")?.mode).toBe("keys");
    expect(parseDesktopInputFallback("move cursor left 3")?.mode).toBe(
      "sequence",
    );
    expect(parseDesktopInputFallback("move my cursor down")?.mode).toBe(
      "sequence",
    );
    const left5 = parseDesktopInputFallback("move my cursor left 5");
    expect(left5?.mode).toBe("sequence");
    if (left5?.mode === "sequence") {
      expect(left5.sequence).toHaveLength(5);
      expect(left5.sequence[0]?.value).toBe("{LEFT}");
    }
    expect(parseDesktopInputFallback("move my cursor up")?.mode).toBe(
      "sequence",
    );
    expect(parseDesktopInputFallback("move my mouse cursor down")?.mode).toBe(
      "sequence",
    );
    expect(parseDesktopInputFallback("move my cursor to the end")?.keys).toBe(
      "{END}",
    );
  });

  it("separates physical mouse moves from text caret moves", () => {
    const mouseUp = parseDesktopInputFallback("move the mouse up");
    expect(mouseUp?.mode).toBe("mouse");
    if (mouseUp?.mode === "mouse") {
      expect(mouseUp.action).toBe("move");
      expect(mouseUp.deltaY).toBe(-100);
    }
    const myMouse = parseDesktopInputFallback("move my mouse left 50");
    expect(myMouse?.mode).toBe("mouse");
    if (myMouse?.mode === "mouse") {
      expect(myMouse.deltaX).toBe(-50);
    }
    const caret = parseDesktopInputFallback("move cursor up");
    expect(caret?.mode).toBe("sequence");
    if (caret?.mode === "sequence") {
      expect(caret.sequence[0]?.value).toBe("{UP}");
    }
    expect(parseDesktopInputFallback("move the mouse cursor up")?.mode).toBe(
      "sequence",
    );
  });

  it("maps STT homophone that's all to select all", () => {
    expect(parseDesktopInputFallback("That's all")?.keys).toBe("^a");
  });

  it("maps paste hier STT homophone to ctrl+v", () => {
    expect(parseDesktopInputFallback("Paste hier")?.keys).toBe("^v");
    expect(parseDesktopInputFallback("paste hear")?.keys).toBe("^v");
  });

  it("maps scroll down to page down key in editors", () => {
    expect(parseDesktopInputFallback("scroll down")?.keys).toBe("{PGDN}");
    expect(parseDesktopInputFallback("scroll up")?.keys).toBe("{PGUP}");
  });

  it("maps select all and copy as key sequence", () => {
    const parsed = parseDesktopInputFallback("select all and copy");
    expect(parsed?.mode).toBe("sequence");
    if (parsed?.mode === "sequence") {
      expect(parsed.sequence).toHaveLength(2);
      expect(parsed.sequence[0]?.value).toBe("^a");
      expect(parsed.sequence[1]?.value).toBe("^c");
    }
  });

  it("maps Urdu Arabic script select all and copy", () => {
    const urdu = "سیلیکٹ اول اینڈ کاپی";
    const parsed = parseDesktopInputFallback(urdu);
    expect(parsed?.mode).toBe("sequence");
    if (parsed?.mode === "sequence") {
      expect(parsed.sequence[0]?.value).toBe("^a");
      expect(parsed.sequence[1]?.value).toBe("^c");
    }
  });

  it("maps move mouse left", () => {
    const parsed = parseDesktopInputFallback("move mouse left");
    expect(parsed?.mode).toBe("mouse");
    if (parsed?.mode === "mouse") {
      expect(parsed.action).toBe("move");
      expect(parsed.deltaX).toBe(-100);
    }
  });
  it("maps paste copied text to ctrl+v", () => {
    expect(parseDesktopInputFallback("Paste the text which you copied")?.keys).toBe(
      "^v",
    );
    expect(parseDesktopInputFallback("Paste the text you copied")?.keys).toBe("^v");
    expect(parseDesktopInputFallback("Paste this text here")?.keys).toBe("^v");
    expect(parseDesktopInputFallback("paste here")?.keys).toBe("^v");
  });

  it("maps delete commands", () => {
    expect(parseDesktopInputFallback("delete all")?.mode).toBe("sequence");
    expect(parseDesktopInputFallback("delete all the text")?.mode).toBe("sequence");
    expect(parseDesktopInputFallback("clear all the text")?.mode).toBe("sequence");
    expect(parseDesktopInputFallback("delete this")?.keys).toBe("{DELETE}");
    expect(parseDesktopInputFallback("clear everything")?.mode).toBe("sequence");
  });

  it("strips write stutter for calculator digits", () => {
    expect(normalizeVoiceStutter("Write, Write 25")).toBe("25");
    expect(parseCalculatorInput("Write, Write 25")?.text).toBe("25");
    expect(parseCalculatorInput("25 plus 25")?.text).toBe("25+25=");
  });
});

describe("P8.5 universal planner", () => {
  it("maps compose with body to type_text", () => {
    const plan = planUniversalIntent(
      "Write a professional email: Dear Sir, I am writing to apply for the role.",
    );
    expect(plan.kind).toBe("execute");
    if (plan.kind === "execute") {
      expect(plan.tool).toBe("desktop.type_text");
      expect(plan.confidence).toBeGreaterThan(0.8);
    }
  });

  it("maps paste this text here via universal planner", () => {
    const plan = planUniversalIntent("Paste this text here");
    expect(plan.kind).toBe("execute");
    if (plan.kind === "execute") {
      expect(plan.tool).toBe("desktop.press_keys");
      expect(plan.reason).toMatch(/p85:L0/);
    }
  });

  it("maps daal do to type_text", () => {
    const plan = planUniversalIntent("daal do hello");
    expect(plan.kind).toBe("execute");
    if (plan.kind === "execute") {
      expect(plan.tool).toBe("desktop.type_text");
    }
  });

  it("defers compose without body to LLM", () => {
    const plan = planUniversalIntent("Can you write a professional email");
    expect(plan.kind).toBe("defer");
    if (plan.kind === "defer") {
      expect(plan.reason).toBe("compose_needs_llm");
    }
  });

  it("asks clarify for ambiguous send", () => {
    const plan = planUniversalIntent("Send this to Ahmed");
    expect(plan.kind).toBe("clarify");
  });

  it("maps calculator math when Calculator is focused", () => {
    const plan = planUniversalIntent("25 plus 25", {
      capturedAt: Date.now(),
      foreground: {
        hwnd: 1,
        processName: "ApplicationFrameHost",
        windowTitle: "Calculator",
      },
      focusedField: null,
      focusContext: null,
      browser: { surface: null },
      clipboard: { hasText: false, preview: "", length: 0 },
      capabilities: {
        sidecarConnected: true,
        sendInput: true,
        uia: true,
        ocr: true,
      },
      activeGoal: null,
    });
    expect(plan.kind).toBe("execute");
    if (plan.kind === "execute") {
      expect(plan.reason).toMatch(/p85:L0/);
    }
  });

  it("does not treat paste copied as literal text", () => {
    for (const phrase of [
      "Paste the text which you copied",
      "Paste the text you copied",
    ]) {
      const plan = planUniversalIntent(phrase);
      expect(plan.kind).toBe("execute");
      if (plan.kind === "execute" && plan.payload.parsed?.mode === "keys") {
        expect(plan.payload.parsed.keys).toBe("^v");
      }
    }
  });
});

describe("P9 agent compound", () => {
  it("open notepad and type hello", () => {
    const payload = tryAgentCompoundCommand(
      "Open Notepad and type hello world",
    );
    expect(payload?.intent).toBe("workflow");
    expect(payload?.actions?.[0]?.type).toBe("WORKFLOW");
  });
});

describe("P9 GPT type_text mapping", () => {
  it("maps type_text plan to type_text intent", () => {
    const intent = nativeIntentFromLlmPlan({
      action: "type_text",
      entities: { text: "hello" },
      confidence: 0.9,
    });
    expect(intent).toEqual({
      kind: "type_text",
      text: "hello",
      replaceAll: false,
    });
  });
});

describe("P8.5 goal manager", () => {
  it("parses goal control phrases", () => {
    expect(parseGoalControlCommand("pause goal")).toBe("pause");
    expect(parseGoalControlCommand("continue goal")).toBe("continue");
    expect(parseGoalControlCommand("cancel goal")).toBe("cancel");
  });

  it("starts and reads active goal", () => {
    completeGoal("test cleanup");
    const goal = startGoal("Test portfolio build", 3);
    expect(goal.summary).toContain("portfolio");
    expect(getActiveGoal()?.goalId).toBe(goal.goalId);
    completeGoal("done");
  });
});
