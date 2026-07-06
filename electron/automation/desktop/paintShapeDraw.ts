import { delay } from "../delay.js";
import {
  restoreFocusContext,
  resolveTypingFocusTarget,
} from "../../focus/focusContext.js";
import {
  clickUiaInWindowNative,
  focusWindowByHwnd,
  getWindowRectNative,
  mouseClickNative,
  mouseDragNative,
  sendKeysNative,
} from "../../native/win32Bridge.js";

export type PaintWindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PaintCanvasMetrics = {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type PaintShapeKind =
  | "ellipse"
  | "rect"
  | "line"
  | "star"
  | "triangle"
  | "heart";

const SHAPE_UIA_NAMES: Record<PaintShapeKind, string[]> = {
  ellipse: ["Oval", "Circle", "Ellipses"],
  rect: ["Rectangle", "Square", "Rectangles"],
  line: ["Line", "Lines"],
  star: ["Star", "Stars"],
  triangle: ["Triangle", "Right triangle", "Isosceles triangle"],
  heart: ["Heart", "Hearts"],
};

/** Win11 Paint — canvas area below ribbon and beside left tool rail. */
export function paintCanvasMetrics(rect: PaintWindowRect): PaintCanvasMetrics {
  const leftInset = Math.max(56, Math.round(rect.width * 0.08));
  const topInset = Math.max(130, Math.round(rect.height * 0.18));
  const bottomInset = Math.max(28, Math.round(rect.height * 0.05));
  const canvasLeft = rect.x + leftInset;
  const canvasTop = rect.y + topInset;
  const canvasWidth = Math.max(120, rect.width - leftInset - 8);
  const canvasHeight = Math.max(120, rect.height - topInset - bottomInset);
  return {
    left: canvasLeft,
    top: canvasTop,
    width: canvasWidth,
    height: canvasHeight,
    centerX: Math.round(canvasLeft + canvasWidth / 2),
    centerY: Math.round(canvasTop + canvasHeight / 2),
  };
}

/** Left toolbar — Shapes tool (not Brushes). */
export function paintLeftShapesToolPoint(rect: PaintWindowRect): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(rect.x + Math.max(28, rect.width * 0.028)),
    y: Math.round(rect.y + rect.height * 0.36),
  };
}

/** Ribbon icon X as fraction of window width (Home tab, shapes row). */
const SHAPE_RIBBON_X: Record<PaintShapeKind, number> = {
  line: 0.28,
  ellipse: 0.33,
  rect: 0.38,
};

const RIBBON_Y_FRAC = 0.17;

export function paintShapeRibbonPoint(
  rect: PaintWindowRect,
  shape: PaintShapeKind,
): { x: number; y: number } {
  return {
    x: Math.round(rect.x + rect.width * SHAPE_RIBBON_X[shape]),
    y: Math.round(rect.y + rect.height * RIBBON_Y_FRAC),
  };
}

export function normalizePaintShape(shape: string): PaintShapeKind {
  const s = shape.toLowerCase();
  if (s === "star") return "star";
  if (s === "triangle") return "triangle";
  if (s === "heart") return "heart";
  if (s === "rect" || s === "rectangle" || s === "square" || s === "box") {
    return "rect";
  }
  if (s === "line") return "line";
  return "ellipse";
}

function drewShapeMessage(shape: PaintShapeKind): string {
  switch (shape) {
    case "star":
      return "Drew star in Paint";
    case "triangle":
      return "Drew triangle in Paint";
    case "heart":
      return "Drew heart in Paint";
    case "rect":
      return "Drew rectangle in Paint";
    case "line":
      return "Drew line in Paint";
    default:
      return "Drew ellipse in Paint";
  }
}

export function paintDragBox(
  canvas: PaintCanvasMetrics,
  shape: PaintShapeKind,
  radius = 72,
  length = 140,
  offsetX = 0,
): { fromX: number; fromY: number; toX: number; toY: number } {
  const cx = canvas.centerX + offsetX;
  const r = Math.min(
    radius,
    Math.floor(Math.min(canvas.width, canvas.height) * 0.22),
  );
  if (shape === "line") {
    const half = Math.min(length / 2, Math.floor(canvas.width * 0.28));
    return {
      fromX: cx - half,
      fromY: canvas.centerY,
      toX: cx + half,
      toY: canvas.centerY,
    };
  }
  return {
    fromX: cx - r,
    fromY: canvas.centerY - r,
    toX: cx + r,
    toY: canvas.centerY + r,
  };
}

function isMspaintProcess(name: string): boolean {
  const p = (name ?? "").toLowerCase();
  return p === "mspaint" || p.includes("paint");
}

async function dismissPaintMenuFocus(hwnd: number): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await sendKeysNative({
      hwnd,
      titleHint: "Paint",
      keys: "{ESC}",
      delayMs: 60,
    });
    await delay(120);
  }
}

async function clickPaintPoint(
  x: number,
  y: number,
  label: string,
): Promise<void> {
  const click = await mouseClickNative({ x, y, button: "left" });
  if (!click?.ok) {
    throw new Error(`paint_click_failed:${label}`);
  }
  console.info(`[ripple-desktop] paint click → ${label} at (${x},${y})`);
  await delay(220);
}

/** Win11 Paint keeps Brushes active unless Shapes is selected on the left rail. */
async function activatePaintShapesMode(
  hwnd: number,
  rect: PaintWindowRect,
): Promise<void> {
  const uia = await clickUiaInWindowNative({
    hwnd,
    names: ["Shapes", "Shape"],
    nameContains: "^Shapes?$",
  });
  if (uia?.ok) {
    console.info(`[ripple-desktop] paint shapes mode → UIA "${uia.name}"`);
    await delay(200);
    return;
  }
  const pt = paintLeftShapesToolPoint(rect);
  await clickPaintPoint(pt.x, pt.y, "left_shapes_tool");
}

async function selectPaintShapeTool(
  hwnd: number,
  rect: PaintWindowRect,
  shape: PaintShapeKind,
): Promise<void> {
  const names = SHAPE_UIA_NAMES[shape];
  const uia = await clickUiaInWindowNative({ hwnd, names });
  if (uia?.ok) {
    console.info(
      `[ripple-desktop] paint shape tool → ${shape} UIA "${uia.name}" at (${uia.x},${uia.y})`,
    );
    await delay(220);
    return;
  }

  const point = paintShapeRibbonPoint(rect, shape);
  await clickPaintPoint(point.x, point.y, `ribbon_${shape}`);
}

async function focusPaintCanvas(
  hwnd: number,
  canvas: PaintCanvasMetrics,
): Promise<void> {
  await clickPaintPoint(canvas.centerX, canvas.centerY, "canvas_focus");
  await focusWindowByHwnd(hwnd, "Paint");
  await delay(120);
}

/**
 * Win11 Paint draws with the active brush unless Shapes mode + shape tool are selected.
 */
export async function drawShapeInMspaint(opts: {
  shape: string;
  radius?: number;
  length?: number;
  offsetX?: number;
}): Promise<string> {
  await restoreFocusContext();
  await delay(200);

  const target = resolveTypingFocusTarget();
  if (!target?.hwnd || !isMspaintProcess(target.processName)) {
    throw new Error("paint_not_foreground");
  }

  const hwnd = target.hwnd;
  await focusWindowByHwnd(hwnd, "Paint");
  await delay(250);

  const rect = await getWindowRectNative(hwnd);
  if (!rect) throw new Error("paint_rect_unavailable");

  const shape = normalizePaintShape(opts.shape);
  await dismissPaintMenuFocus(hwnd);
  await activatePaintShapesMode(hwnd, rect);
  await selectPaintShapeTool(hwnd, rect, shape);

  const canvas = paintCanvasMetrics(rect);
  await focusPaintCanvas(hwnd, canvas);

  const box = paintDragBox(
    canvas,
    shape,
    typeof opts.radius === "number" ? opts.radius : 72,
    typeof opts.length === "number" ? opts.length : 140,
    typeof opts.offsetX === "number" ? opts.offsetX : 0,
  );

  const drag = await mouseDragNative({
    ...box,
    button: "left",
  });
  if (!drag?.ok) {
    throw new Error("paint_shape_drag_failed");
  }

  console.info(
    `[ripple-desktop] paint shape drag → ${shape} (${box.fromX},${box.fromY})→(${box.toX},${box.toY})`,
  );
  return drewShapeMessage(shape);
}

export function shouldUsePaintShapeDraw(processName: string): boolean {
  return isMspaintProcess(processName);
}

async function withPaintForeground(
  fn: (hwnd: number, rect: PaintWindowRect, canvas: PaintCanvasMetrics) => Promise<string>,
): Promise<string> {
  await restoreFocusContext();
  await delay(200);
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd || !isMspaintProcess(target.processName)) {
    throw new Error("paint_not_foreground");
  }
  const hwnd = target.hwnd;
  await focusWindowByHwnd(hwnd, "Paint");
  await delay(250);
  const rect = await getWindowRectNative(hwnd);
  if (!rect) throw new Error("paint_rect_unavailable");
  await dismissPaintMenuFocus(hwnd);
  const canvas = paintCanvasMetrics(rect);
  return fn(hwnd, rect, canvas);
}

/** Bucket-fill the shape at canvas center. */
export async function fillShapeInMspaint(): Promise<string> {
  return withPaintForeground(async (hwnd, rect, canvas) => {
    const fill = await clickUiaInWindowNative({
      hwnd,
      names: ["Fill", "Bucket"],
      nameContains: "Fill",
    });
    if (!fill?.ok) {
      const pt = paintLeftShapesToolPoint(rect);
      await clickPaintPoint(pt.x, pt.y + 48, "fill_tool_fallback");
    } else {
      console.info(`[ripple-desktop] paint fill tool → UIA "${fill.name}"`);
      await delay(200);
    }
    await clickPaintPoint(canvas.centerX, canvas.centerY, "fill_click");
    return "Filled shape in Paint";
  });
}

/** Undo last stroke (legacy alias). */
export async function undoPaintStroke(): Promise<string> {
  return eraseInMspaint();
}

/** Erase last shape — Ctrl+Z then eraser drag over canvas center. */
export async function eraseInMspaint(): Promise<string> {
  return withPaintForeground(async (hwnd, rect, canvas) => {
    await focusPaintCanvas(hwnd, canvas);
    for (let i = 0; i < 2; i++) {
      await sendKeysNative({ hwnd, titleHint: "Paint", keys: "^z", delayMs: 80 });
      await delay(400);
    }
    const eraser = await clickUiaInWindowNative({
      hwnd,
      names: ["Eraser", "Rubber"],
      nameContains: "Eraser",
    });
    if (eraser?.ok) {
      console.info(`[ripple-desktop] paint eraser → UIA "${eraser.name}"`);
      await delay(200);
      const r = 48;
      await mouseDragNative({
        fromX: canvas.centerX - r,
        fromY: canvas.centerY - r,
        toX: canvas.centerX + r,
        toY: canvas.centerY + r,
        button: "left",
      });
      await delay(200);
    }
    return "Erased shape in Paint";
  });
}

/** Place text on canvas via Paint Text tool (not keyboard typing into Pane). */
export async function labelTextInMspaint(text: string): Promise<string> {
  return withPaintForeground(async (hwnd, rect, canvas) => {
    const textTool = await clickUiaInWindowNative({
      hwnd,
      names: ["Text", "Add text"],
      nameContains: "Text",
    });
    if (!textTool?.ok) {
      const pt = paintLeftShapesToolPoint(rect);
      await clickPaintPoint(pt.x, pt.y + 96, "text_tool_fallback");
    } else {
      console.info(`[ripple-desktop] paint text tool → UIA "${textTool.name}"`);
      await delay(200);
    }
    await clickPaintPoint(canvas.centerX, canvas.centerY + 24, "text_placement");
    await delay(350);
    const typed = await sendKeysNative({
      hwnd,
      titleHint: "Paint",
      text,
      delayMs: 35,
    });
    if (!typed?.ok) {
      throw new Error("paint_label_type_failed");
    }
    await delay(200);
    await sendKeysNative({
      hwnd,
      titleHint: "Paint",
      keys: "{ENTER}",
      delayMs: 80,
    });
    console.info(`[ripple-desktop] paint label → "${text}"`);
    return `Labeled Paint with "${text}"`;
  });
}

/** Clear the canvas via Select all + Delete. */
export async function clearPaintCanvas(): Promise<string> {
  return withPaintForeground(async (hwnd, _rect, canvas) => {
    await focusPaintCanvas(hwnd, canvas);
    await sendKeysNative({ hwnd, titleHint: "Paint", keys: "^a", delayMs: 80 });
    await delay(120);
    await sendKeysNative({ hwnd, titleHint: "Paint", keys: "{DELETE}", delayMs: 80 });
    return "Cleared Paint canvas";
  });
}
