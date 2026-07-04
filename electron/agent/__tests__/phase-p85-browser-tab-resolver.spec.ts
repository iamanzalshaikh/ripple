import { describe, expect, it, vi } from "vitest";
import {
  isBrowserProcess,
  resolveTabTargetFromWorkspace,
  shouldNavigateInActiveBrowser,
} from "../../automation/browser/browserTabResolver.js";
import { findWorkspaceById } from "../../automation/desktop/workspaceRegistry.js";

vi.mock("../../focus/focusContext.js", () => ({
  getFocusContext: vi.fn(() => ({
    processName: "chrome",
    windowTitle: "Swagger UI - Google Chrome",
    activeTabUrl: "http://localhost:3000/swagger",
  })),
  restoreFocusContext: vi.fn(async () => undefined),
}));

describe("browserTabResolver", () => {
  it("detects browser processes", () => {
    expect(isBrowserProcess("chrome")).toBe(true);
    expect(isBrowserProcess("notepad")).toBe(false);
  });

  it("prefers active tab navigation when browser is focused", () => {
    expect(shouldNavigateInActiveBrowser()).toBe(true);
  });

  it("builds workspace tab targets with url", () => {
    const ws = findWorkspaceById("youtube");
    expect(ws).toBeDefined();
    const target = resolveTabTargetFromWorkspace(ws!);
    expect(target.type).toBe("url");
    expect(target.url).toMatch(/youtube\.com/i);
    expect(target.workspaceId).toBe("youtube");
  });
});
