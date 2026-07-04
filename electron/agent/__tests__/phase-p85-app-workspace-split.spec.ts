import { describe, expect, it } from "vitest";
import { parseBrowserWorkspaceSearch } from "../../automation/browser/parseBrowserWorkspaceSearch.js";
import { parseNativeCommandStrict } from "../../automation/desktop/parseNativeCommand.js";
import { nativeIntentToPlanStep } from "../planner/nativeIntentToPlanStep.js";
import { shouldBlockLegacyDesktopRouters } from "../planner/p85LegacyGate.js";

describe("P8.5 app vs workspace tool separation", () => {
  it("open chrome maps to desktop.launch_app", () => {
    const intent = parseNativeCommandStrict("open chrome");
    expect(intent?.kind).toBe("launch_app");
    const step = nativeIntentToPlanStep(intent!);
    expect(step?.tool).toBe("desktop.launch_app");
  });

  it("open youtube maps to browser.open_workspace", () => {
    const intent = parseNativeCommandStrict("open youtube");
    expect(intent?.kind).toBe("open_workspace");
    const step = nativeIntentToPlanStep(intent!);
    expect(step?.tool).toBe("browser.open_workspace");
    expect(step?.tool).not.toBe("desktop.launch_app");
  });

  it("search cats maps to browser.search_workspace", () => {
    const intent = parseBrowserWorkspaceSearch("search cats");
    expect(intent?.kind).toBe("browser_search");
    const step = nativeIntentToPlanStep(intent!);
    expect(step?.tool).toBe("browser.search_workspace");
  });

  it("blocks legacy desktop-fast when p85 owns workspace open", () => {
    expect(shouldBlockLegacyDesktopRouters("Open YouTube")).toBe(true);
    expect(shouldBlockLegacyDesktopRouters("Switch to Chrome and open YouTube")).toBe(
      true,
    );
  });
});
