import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0WhatsAppPlan } from "../planner/l0WhatsAppPlanner.js";
import { runPlannerPipeline } from "../planner/index.js";
import {
  extractContactName,
  LAST_CONTACT_MARKER,
  resolveWhatsAppMessageText,
} from "../../automation/adapters/whatsapp/parseContact.js";
import { matchContactWithConfidence } from "../../automation/contacts/contactMatch.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/adapters/whatsapp/runWhatsAppAction.js", () => ({
  runWhatsAppBatch: vi.fn(async () => "Opened WhatsApp"),
}));

vi.mock("../../automation/adapters/whatsapp/whatsappAdapter.js", () => ({
  runWhatsAppMessageFlow: vi.fn(async () => "Sent WhatsApp message"),
}));

let whatsappTabActive = false;
let lastContact: string | null = null;

vi.mock("../../focus/focusContext.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../focus/focusContext.js")>();
  return { ...actual, isWhatsAppTabActive: () => whatsappTabActive };
});

vi.mock("../../storage/lastCommandState.js", () => ({
  getLastCommandContext: () => ({
    last_file: null,
    last_folder: null,
    last_project: null,
    last_contact: lastContact,
    last_app: null,
    last_workspace: null,
  }),
  rememberContact: vi.fn(),
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

describe("P8.5 WhatsApp final stabilization", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
    whatsappTabActive = false;
    lastContact = null;
    clearRegisteredToolsForTests();
    resetPhase1BrowserToolsForTests();
    registerPhase1BrowserTools();
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("Test A — Message Aftab saying hello", () => {
    const result = tryL0WhatsAppPlan(
      "Message Aftab saying hello",
      "message aftab saying hello",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[0]?.args.contact).toBe("Aftab");
    expect(result.plan.steps[0]?.args.message).toBe("hello");
    expect(result.plan.steps[0]?.args.send).toBe(true);
  });

  it("Test B — Send Aftab: I am late", () => {
    const pipeline = runPlannerPipeline({
      command: "Send Aftab: I am late",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(pipeline.plan.steps[0]?.tool).toBe("browser.whatsapp.send");
    expect(pipeline.plan.steps[0]?.args.contact).toBe("Aftab");
    expect(pipeline.plan.steps[0]?.args.message).toBe("I am late");
    expect(pipeline.plan.steps[0]?.args.send).toBe(true);
  });

  it("Test C — Message my brother I reached home", () => {
    expect(extractContactName("Message my brother I reached home")).toBe(
      "my brother",
    );
    expect(resolveWhatsAppMessageText("Message my brother I reached home")).toBe(
      "I reached home",
    );
    const result = tryL0WhatsAppPlan(
      "Message my brother I reached home",
      "message my brother i reached home",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.args.contact).toBe("my brother");
    expect(result.plan.steps[0]?.args.message).toBe("I reached home");
    expect(result.plan.steps[0]?.args.send).toBe(true);
  });

  it("parses Message Ammi 1 I will come tomorrow without splitting digit into message", () => {
    expect(extractContactName("Message Ammi 1 I will come tomorrow")).toBe(
      "Ammi 1",
    );
    expect(resolveWhatsAppMessageText("Message Ammi 1 I will come tomorrow")).toBe(
      "I will come tomorrow",
    );
  });

  it("Test D — Send him resolves last_contact", () => {
    lastContact = "Noor";
    expect(extractContactName("Send him I will call later")).toBe(
      LAST_CONTACT_MARKER,
    );
    const result = tryL0WhatsAppPlan(
      "Send him I will call later",
      "send him i will call later",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.args.contact).toBe("Noor");
    expect(result.plan.steps[0]?.args.message).toBe("I will call later");
    expect(result.plan.steps[0]?.args.send).toBe(true);
  });

  it("Test D — defers when pronoun but no last_contact", () => {
    lastContact = null;
    const result = tryL0WhatsAppPlan(
      "Send him I will call later",
      "send him i will call later",
    );
    expect(result?.kind).toBe("defer");
    if (result?.kind === "defer") {
      expect(result.reason).toBe("no_last_contact");
    }
  });

  it("Test E — clearly-spoken name auto-proceeds (no blocking modal)", () => {
    // Autonomous agent: with no desktop-side contact list, trust the transcript
    // and let the WhatsApp extension fuzzy-match. No confirmation dialog.
    const match = matchContactWithConfidence("XYZ123", {
      whatsAppSessionNames: [],
    });
    expect(match.tier).toBe("auto");
    expect(match.best.name).toBe("XYZ123");
  });

  it("Test E — ambiguous match against known contacts asks to disambiguate", () => {
    const match = matchContactWithConfidence("Afta", {
      whatsAppSessionNames: ["Aftab", "Aftar"],
    });
    expect(match.tier).not.toBe("auto");
  });

  it("Test E — unresolved pronoun asks (empty memory)", () => {
    const match = matchContactWithConfidence("him", {
      whatsAppSessionNames: [],
    });
    expect(match.tier).toBe("ask");
  });

  it("Open WhatsApp chat with contact is open-only send:false", () => {
    const result = tryL0WhatsAppPlan(
      "Open WhatsApp chat with Aftab dev",
      "open whatsapp chat with aftab dev",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.args.contact).toBe("Aftab dev");
    expect(result.plan.steps[0]?.args.send).toBe(false);
    expect(result.plan.steps[0]?.args.message).toBe("");
  });
});
