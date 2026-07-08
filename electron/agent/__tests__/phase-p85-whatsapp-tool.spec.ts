import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0WhatsAppPlan } from "../planner/l0WhatsAppPlanner.js";
import { clearMemory, setMemory } from "../../storage/sessionMemory.js";
import {
  buildExecutorPayload,
  runPlannerPipeline,
  shouldBypassP85Planner,
  tryCompoundGate,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/adapters/whatsapp/runWhatsAppAction.js", () => ({
  runWhatsAppBatch: vi.fn(async () => "Opened WhatsApp"),
}));

vi.mock("../../automation/adapters/whatsapp/whatsappAdapter.js", () => ({
  runWhatsAppMessageFlow: vi.fn(async () => "Sent WhatsApp message"),
}));

let whatsappTabActive = false;
vi.mock("../../focus/focusContext.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../focus/focusContext.js")>();
  return { ...actual, isWhatsAppTabActive: () => whatsappTabActive };
});

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

describe("P8.5 WhatsApp tool planner", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
    clearRegisteredToolsForTests();
    resetPhase1BrowserToolsForTests();
    registerPhase1BrowserTools();
  });

  afterEach(() => {
    whatsappTabActive = false;
    clearMemory("last_file");
    clearMemory("last_folder");
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("bare 'search X' while WhatsApp focused opens the chat, not Google", () => {
    whatsappTabActive = true;
    const result = tryL0WhatsAppPlan("Search Dr. Fatima", "search dr. fatima");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[0]?.args.contact).toBe("Dr. Fatima");
    expect(result.plan.steps[0]?.args.send).toBe(false);
    expect(result.plan.steps[0]?.args.message).toBe("");
  });

  it("bare 'search X' with WhatsApp NOT focused stays web search (null)", () => {
    whatsappTabActive = false;
    const result = tryL0WhatsAppPlan("Search Dr. Fatima", "search dr. fatima");
    expect(result).toBeNull();
  });

  it("pipeline keeps bare search in whatsapp when focused", () => {
    whatsappTabActive = true;
    const pipeline = runPlannerPipeline({
      command: "Search Dr. Fatima",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(pipeline.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(pipeline.plan.steps[0]?.args.contact).toBe("Dr. Fatima");
  });

  it("plans open whatsapp via browser.open_workspace", () => {
    const result = tryL0WhatsAppPlan("Open WhatsApp", "open whatsapp");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
    expect(result.plan.steps[0]?.args.url).toBe("https://web.whatsapp.com");
  });

  it("plans message noor hello via browser.whatsapp.send", () => {
    const result = tryL0WhatsAppPlan(
      "Message Noor hello",
      "message noor hello",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[0]?.args.contact).toBe("Noor");
    expect(result.plan.steps[0]?.args.message).toMatch(/hello/i);
  });

  it("does not plan ambiguous send without prior file context", () => {
    const result = tryL0WhatsAppPlan(
      "Send this to Ahmed",
      "send this to ahmed",
    );
    expect(result).toBeNull();
  });

  it("plans referential send via browser.whatsapp.send", () => {
    setMemory("last_file", "C:\\Users\\me\\resume.pdf");
    const result = tryL0WhatsAppPlan("Send it to Noor", "send it to noor");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[0]?.args.mode).toBe("referential_send");
    expect(result.plan.steps[0]?.args.contact).toBe("Noor");
    expect(result.plan.steps[0]?.args.referentialMode).toBe("send_file");
  });

  it("plans search Dr Fatima and ask via browser.whatsapp.send not google", () => {
    const result = tryL0WhatsAppPlan(
      "Search Dr. Fatima and ask how are you",
      "search dr. fatima and ask how are you",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[0]?.args.contact).toBe("Dr. Fatima");
    expect(result.plan.steps[0]?.args.message).toMatch(/how are you/i);
    expect(result.plan.steps[0]?.args.send).toBe(true);
  });

  it("plans search X and type MESSAGE with extracted text + send", () => {
    const result = tryL0WhatsAppPlan(
      "Search Aftab and type when are you coming",
      "search aftab and type when are you coming",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[0]?.args.contact).toBe("Aftab");
    expect(result.plan.steps[0]?.args.message).toMatch(/when are you coming/i);
    expect(result.plan.steps[0]?.args.send).toBe(true);
  });

  it("plans search X and write MESSAGE with extracted text + send", () => {
    const result = tryL0WhatsAppPlan(
      "Search Aftab and write good morning",
      "search aftab and write good morning",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[0]?.args.contact).toBe("Aftab");
    expect(result.plan.steps[0]?.args.message).toMatch(/good morning/i);
    expect(result.plan.steps[0]?.args.send).toBe(true);
  });

  it("parses 'send whatsapp message to X saying Y' correctly", () => {
    const result = tryL0WhatsAppPlan(
      "Send WhatsApp message to Aftab dev saying hello",
      "send whatsapp message to aftab dev saying hello",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[0]?.args.contact).toBe("Aftab dev");
    expect(result.plan.steps[0]?.args.message).toBe("hello");
    expect(result.plan.steps[0]?.args.send).toBe(true);
  });

  it("parses 'message X: Y' colon form with send", () => {
    const result = tryL0WhatsAppPlan(
      "Message Aftab dev: I will come tomorrow",
      "message aftab dev: i will come tomorrow",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.args.contact).toBe("Aftab dev");
    expect(result.plan.steps[0]?.args.message).toBe("I will come tomorrow");
    expect(result.plan.steps[0]?.args.send).toBe(true);
  });

  it("parses 'open whatsapp chat with X' as open-only", () => {
    const result = tryL0WhatsAppPlan(
      "Open WhatsApp chat with Aftab dev",
      "open whatsapp chat with aftab dev",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.args.contact).toBe("Aftab dev");
    expect(result.plan.steps[0]?.args.message).toBe("");
    expect(result.plan.steps[0]?.args.send).toBe(false);
  });

  it("pipeline routes search Dr Fatima through whatsapp tool", () => {
    const pipeline = runPlannerPipeline({
      command: "Search Dr. Fatima and ask how are you",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(pipeline.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(pipeline.plan.steps[0]?.args.contact).toBe("Dr. Fatima");
  });

  it("compound gate does not split whatsapp search-and-ask into web search", () => {
    const gate = tryCompoundGate(
      "Search Dr. Fatima and ask how are you",
      "search dr. fatima and ask how are you",
    );
    expect(gate).toBeNull();
  });

  it("pipeline executes open whatsapp through tool executor", () => {
    const pipeline = runPlannerPipeline({
      command: "Open WhatsApp",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(pipeline.plan.steps[0]?.tool).toBe("browser.open_workspace");

    const built = buildExecutorPayload(
      pipeline.plan,
      "Open WhatsApp",
      stubWorld(),
    );
    expect(built.kind).toBe("executor");
  });

  it("does not bypass P85 for whatsapp utterances", () => {
    expect(shouldBypassP85Planner("Open WhatsApp")).toBe(false);
    expect(
      shouldBypassP85Planner(
        "Open WhatsApp and search Dr. Fatima and ask how are you",
      ),
    ).toBe(false);
  });
});
