import { describe, expect, it } from "vitest";
import {
  normalizePaintShape,
  paintCanvasMetrics,
  paintDragBox,
  paintShapeRibbonPoint,
  shouldUsePaintShapeDraw,
} from "../../automation/desktop/paintShapeDraw.js";

describe("Paint shape draw geometry", () => {
  const rect = { x: 100, y: 50, width: 900, height: 700 };

  it("maps circle to ellipse shape kind", () => {
    expect(normalizePaintShape("circle")).toBe("ellipse");
    expect(normalizePaintShape("oval")).toBe("ellipse");
  });

  it("maps rectangle to rect and triangle to triangle", () => {
    expect(normalizePaintShape("rectangle")).toBe("rect");
    expect(normalizePaintShape("triangle")).toBe("triangle");
    expect(normalizePaintShape("star")).toBe("star");
  });

  it("computes canvas below ribbon not window center", () => {
    const canvas = paintCanvasMetrics(rect);
    expect(canvas.centerY).toBeGreaterThan(rect.y + rect.height / 2);
    expect(canvas.centerX).toBeGreaterThan(rect.x + 40);
    expect(canvas.width).toBeGreaterThan(400);
    expect(canvas.height).toBeGreaterThan(400);
  });

  it("ellipse drag uses square bounding box on canvas", () => {
    const canvas = paintCanvasMetrics(rect);
    const box = paintDragBox(canvas, "ellipse", 80);
    expect(box.toX - box.fromX).toBe(160);
    expect(box.toY - box.fromY).toBe(160);
    expect(box.fromX).toBeLessThan(canvas.centerX);
    expect(box.toX).toBeGreaterThan(canvas.centerX);
    expect(box.fromY).toBeLessThan(canvas.centerY);
    expect(box.toY).toBeGreaterThan(canvas.centerY);
  });

  it("line drag is horizontal through canvas center", () => {
    const canvas = paintCanvasMetrics(rect);
    const box = paintDragBox(canvas, "line", 72, 160);
    expect(box.fromY).toBe(box.toY);
    expect(box.fromY).toBe(canvas.centerY);
    expect(box.toX).toBeGreaterThan(box.fromX);
  });

  it("ribbon points differ per shape", () => {
    const line = paintShapeRibbonPoint(rect, "line");
    const oval = paintShapeRibbonPoint(rect, "ellipse");
    const square = paintShapeRibbonPoint(rect, "rect");
    expect(oval.x).toBeGreaterThan(line.x);
    expect(square.x).toBeGreaterThan(oval.x);
    expect(line.y).toBe(oval.y);
  });

  it("detects mspaint process names", () => {
    expect(shouldUsePaintShapeDraw("mspaint")).toBe(true);
    expect(shouldUsePaintShapeDraw("MSPaint")).toBe(true);
    expect(shouldUsePaintShapeDraw("notepad")).toBe(false);
  });
});

describe("Paint draw planner matrix (25 cases)", () => {
  const drawPhrases = [
    "open paint and draw a circle",
    "open paint and draw rectangle",
    "open paint then draw line",
    "launch paint and draw triangle",
    "open paint and sketch shape",
    "open paint and type draw circle",
    "open paint and draw oval",
    "open paint and draw a square",
    "open paint and draw a line",
    "open paint and draw circle",
    "open paint and draw rect",
    "open paint and sketch a circle",
    "open paint and draw a rectangle",
    "open paint and draw an oval",
    "open paint and draw shape",
  ];

  for (const phrase of drawPhrases) {
    it(`plans mouse drag for: ${phrase}`, async () => {
      const { planCompoundWithV2 } = await import("../planner/v2/plannerV2.js");
      const result = planCompoundWithV2(phrase, phrase.toLowerCase());
      expect(result?.kind).toBe("plan");
      if (result?.kind !== "plan") return;
      const tools = result.plan.steps.map((s) => s.tool);
      expect(tools[0]).toBe("desktop.launch_app");
      expect(tools).toContain("desktop.mouse_drag");
      expect(tools).not.toContain("desktop.type_text");
      expect(result.plan.steps.find((s) => s.tool === "desktop.mouse_drag")?.args.shape).toBeTruthy();
    });
  }
});
