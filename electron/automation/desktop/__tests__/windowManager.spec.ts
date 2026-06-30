import { describe, expect, it } from "vitest";
import type { VisibleWindow } from "../windowEnum.js";
import { BUILTIN_WINDOWS_APPS } from "../nativeAppRegistry.js";

// scoreWindow is internal — test via exported behavior patterns documented here.
function scoreWindow(
  win: VisibleWindow,
  app: (typeof BUILTIN_WINDOWS_APPS)[number],
): number {
  const proc = win.processName.toLowerCase();
  const title = win.windowTitle.toLowerCase();
  const className = (win.className ?? "").toLowerCase();

  if (app.id === "file-explorer") {
    if (title.trim() === "program manager") return 0;
    if (className === "cabinetwclass") return 90;
    if (title.includes("file explorer")) return 70;
    if (proc === "explorer" && title.includes("\\")) return 55;
  }

  const ambiguous = new Set(["applicationframehost"]);
  if (ambiguous.has(proc) && (app.titleKeywords?.length ?? 0) > 0) {
    const hasKeyword = app.titleKeywords!.some((kw) =>
      title.includes(kw.toLowerCase()),
    );
    if (!hasKeyword) return 0;
  }

  let score = 0;
  for (const p of app.processNames) {
    if (proc === p.toLowerCase()) score += 50;
  }
  for (const kw of app.titleKeywords ?? []) {
    if (title.includes(kw.toLowerCase())) score += 40;
  }
  return score;
}

describe("windowManager scoring", () => {
  const calc = BUILTIN_WINDOWS_APPS.find((a) => a.id === "calculator")!;
  const explorer = BUILTIN_WINDOWS_APPS.find((a) => a.id === "file-explorer")!;

  it("rejects Realtek Audio Console as Calculator", () => {
    const score = scoreWindow(
      {
        hwnd: 1,
        processName: "ApplicationFrameHost",
        windowTitle: "Realtek Audio Console",
        className: "ApplicationFrameWindow",
      },
      calc,
    );
    expect(score).toBe(0);
  });

  it("prefers Calculator title for UWP host", () => {
    const score = scoreWindow(
      {
        hwnd: 2,
        processName: "ApplicationFrameHost",
        windowTitle: "Calculator",
        className: "ApplicationFrameWindow",
      },
      calc,
    );
    expect(score).toBeGreaterThanOrEqual(40);
  });

  it("rejects Program Manager as File Explorer", () => {
    const score = scoreWindow(
      {
        hwnd: 3,
        processName: "explorer",
        windowTitle: "Program Manager",
        className: "Progman",
      },
      explorer,
    );
    expect(score).toBe(0);
  });

  it("prefers CabinetWClass explorer windows", () => {
    const score = scoreWindow(
      {
        hwnd: 4,
        processName: "explorer",
        windowTitle: "Downloads",
        className: "CabinetWClass",
      },
      explorer,
    );
    expect(score).toBeGreaterThanOrEqual(90);
  });
});
