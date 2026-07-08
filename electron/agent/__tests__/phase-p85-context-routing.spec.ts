import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0YouTubePlan } from "../planner/l0YouTubePlanner.js";
import { classifyClause } from "../planner/v2/clauseClassifier.js";
import { resolveSearchRoute } from "../context/routingRules.js";
import { resolveRippleContext } from "../context/contextResolver.js";
import type { FocusContext } from "../../focus/focusContext.js";

let focusCtx: FocusContext | null = null;
let stickySurface: string | null = null;

vi.mock("../../focus/focusContext.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../focus/focusContext.js")>();
  return {
    ...actual,
    getFocusContext: () => focusCtx,
    getStickyWebSurface: () => stickySurface,
    isYouTubeFocused: () =>
      Boolean(focusCtx?.isYouTube) || stickySurface === "youtube",
    isWhatsAppTabActive: () => false,
  };
});

vi.mock("../../automation/adapters/youtube/runYouTubeAction.js", () => ({
  runYouTubeBatch: vi.fn(async () => "YouTube done"),
}));

function ytFocus(): FocusContext {
  return {
    hwnd: 123,
    processName: "chrome",
    windowTitle: "React Tutorial - YouTube - Google Chrome",
    activeTabUrl: "https://www.youtube.com/watch?v=abc",
    capturedAt: Date.now(),
    isGmail: false,
    isWhatsApp: false,
    isSlack: false,
    isNotion: false,
    isYouTube: true,
    isLinkedIn: false,
    isInstagram: false,
    isBrowser: true,
  };
}

describe("Context-Aware Routing Engine", () => {
  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    focusCtx = null;
    stickySurface = null;
    clearRegisteredToolsForTests();
    resetPhase1BrowserToolsForTests();
    registerPhase1BrowserTools();
  });

  afterEach(() => {
    focusCtx = null;
    stickySurface = null;
  });

  it("resolves youtube domain from live foreground", () => {
    focusCtx = ytFocus();
    const ctx = resolveRippleContext("search react tutorial");
    expect(ctx.foreground.domain).toBe("youtube.com");
  });

  it("preserves youtube via sticky surface when foreground is Ripple/unknown", () => {
    focusCtx = null;
    stickySurface = "youtube";
    const ctx = resolveRippleContext("search react tutorial");
    expect(ctx.foreground.domain).toBe("youtube.com");
  });

  it("routes bare search to youtube when on youtube", () => {
    focusCtx = ytFocus();
    const route = resolveSearchRoute(resolveRippleContext("search react tutorial"));
    expect(route.decision).toBe("youtube_search");
    expect(route.searchEngine).toBe("youtube");
    expect(route.reason).toMatch(/current_domain=youtube\.com/);
  });

  it("explicit google target overrides youtube context", () => {
    focusCtx = ytFocus();
    const route = resolveSearchRoute(
      resolveRippleContext("search react on google"),
    );
    expect(route.decision).toBe("google_search");
    expect(route.reason).toMatch(/explicit_target=google/);
  });

  it("falls back to generic web search off-site", () => {
    focusCtx = null;
    stickySurface = null;
    const route = resolveSearchRoute(resolveRippleContext("search react tutorial"));
    expect(route.decision).toBe("web_search");
    expect(route.searchEngine).toBe("google");
  });

  it("L0 youtube planner keeps bare search on youtube via browser.youtube.run", () => {
    focusCtx = ytFocus();
    const result = tryL0YouTubePlan(
      "Search javascript tutorial for me",
      "search javascript tutorial for me",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.youtube.run");
    expect(result.plan.steps[0]?.args.query).toMatch(/javascript tutorial/i);
  });

  it("politeness modifiers do not corrupt the query", () => {
    focusCtx = ytFocus();
    const result = tryL0YouTubePlan(
      "Sir, search javascript tutorial please",
      "sir, search javascript tutorial please",
    );
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.args.query).toBe("javascript tutorial");
  });

  it("planner v2 classifier biases bare search to youtube via activeWorkspaceId", () => {
    const rec = classifyClause("search javascript tutorial", 0, {
      priorRecords: [],
      activeWorkspaceId: "youtube",
    });
    expect(rec.clauseType).toBe("MEDIA_SEARCH");
    expect(rec.entities.searchEngine).toBe("youtube");
  });

  it("planner v2 classifier keeps google search off-site", () => {
    const rec = classifyClause("search javascript tutorial", 0, {
      priorRecords: [],
    });
    expect(rec.clauseType).toBe("WEB_SEARCH");
    expect(rec.entities.searchEngine).toBe("google");
  });
});
