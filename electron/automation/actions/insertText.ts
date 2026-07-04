import { hideOverlay } from "../../windows/overlay.js";
import { runWhatsAppMessageFlow } from "../adapters/whatsapp/whatsappAdapter.js";
import {
  extractContactName,
  isWhatsAppMessagingCommand,
} from "../adapters/whatsapp/parseContact.js";
import { isContextualWhatsAppComposeCommand } from "../adapters/whatsapp/parseWhatsAppCommand.js";
import { replaceWhatsAppComposerViaExtension } from "../../bridge/nativeMessagingBridge.js";
import type { FocusContext } from "../../focus/focusContext.js";
import {
  isWeakFocusContext,
  restoreFocusContext,
  resolveTypingFocusTarget,
} from "../../focus/focusContext.js";
import { getLastVoiceCommand } from "../../state/lastCommand.js";
import { smartInsertText } from "../smartInsert.js";
import {
  runInputSequenceNative,
  mouseClickNative,
  mouseDragNative,
  mouseScrollNative,
  mouseMoveNative,
  getCursorPositionNative,
  getWindowCenterNative,
  getWindowRectCenter,
  getWindowUnderCursorNative,
} from "../../native/win32Bridge.js";
import { captureObservation, verifyTypingObservation } from "../../agent/observe.js";
import { retryDesktopKeys } from "../../agent/retryTyping.js";

export async function runInsertText(data?: Record<string, unknown>): Promise<string> {
  const text = typeof data?.text === "string" ? data.text : "";
  const keys = typeof data?.keys === "string" ? data.keys : "";
  const sequence = Array.isArray(data?.sequence) ? data.sequence : [];
  const replaceAll = data?.replaceAll === true;
  const prefocusKeys =
    typeof data?.prefocusKeys === "string" ? data.prefocusKeys : "";
  const mouseAction =
    typeof data?.mouseAction === "string" ? data.mouseAction : "";
  const hasKeyInput = Boolean(keys) || sequence.length > 0;

  if (hasKeyInput) {
    hideOverlay();
  }

  const beforeObserve = await captureObservation();
  if (!hasKeyInput && !mouseAction) {
    hideOverlay();
  }

  if (mouseAction) {
    hideOverlay();
    await restoreFocusContext();
    await new Promise((r) => setTimeout(r, 150));
    const target = resolveTypingFocusTarget();
    if (mouseAction === "move") {
      const deltaX = typeof data?.deltaX === "number" ? data.deltaX : 0;
      const deltaY = typeof data?.deltaY === "number" ? data.deltaY : 0;
      const pos = await getCursorPositionNative();
      if (!pos) throw new Error("Could not read cursor position (native sidecar unavailable)");
      const result = await mouseMoveNative({
        x: pos.x + deltaX,
        y: pos.y + deltaY,
      });
      assertMouseOk(result, "move");
      return `Moved mouse ${deltaX < 0 ? "left" : deltaX > 0 ? "right" : deltaY < 0 ? "up" : "down"}`;
    }
    if (mouseAction === "move_absolute") {
      const x = typeof data?.x === "number" ? data.x : null;
      const y = typeof data?.y === "number" ? data.y : null;
      if (x === null || y === null) throw new Error("Mouse move requires x and y coordinates");
      const result = await mouseMoveNative({ x, y });
      assertMouseOk(result, "move");
      return `Moved mouse to (${x}, ${y})`;
    }
    if (mouseAction === "move_to_center") {
      const center = await resolveMousePoint(data, target);
      const result = await mouseMoveNative({ x: center.x, y: center.y });
      assertMouseOk(result, "move");
      return "Moved mouse to window center";
    }
    if (mouseAction === "drag") {
      const center = await resolveMousePoint(data, target);
      const radius = typeof data?.radius === "number" ? data.radius : 64;
      const shape = String(data?.shape ?? "line");
      let fromX = center.x;
      let fromY = center.y;
      let toX = center.x;
      let toY = center.y;
      if (shape === "ellipse" || shape === "rect") {
        fromX = center.x - radius;
        fromY = center.y - radius;
        toX = center.x + radius;
        toY = center.y + radius;
      } else {
        const length = typeof data?.length === "number" ? data.length : 120;
        fromX = center.x - length / 2;
        toX = center.x + length / 2;
      }
      const drag = await mouseDragNative({
        fromX,
        fromY,
        toX,
        toY,
        button: "left",
      });
      if (!drag?.ok) {
        throw new Error(
          "Mouse drag failed: native sidecar drag unavailable (requires authenticated native host)",
        );
      }
      return shape === "ellipse"
        ? "Drew ellipse"
        : shape === "rect"
          ? "Drew rectangle"
          : "Drew line";
    }
    const point = await resolveMousePoint(data, target);
    if (mouseAction === "scroll_up" || mouseAction === "scroll_down") {
      const defaultDelta = mouseAction === "scroll_up" ? 240 : -240;
      const delta =
        typeof data?.scrollDelta === "number"
          ? mouseAction === "scroll_up"
            ? Math.abs(data.scrollDelta)
            : -Math.abs(data.scrollDelta)
          : defaultDelta;
      const result = await mouseScrollNative({
        x: point.x,
        y: point.y,
        delta,
      });
      assertMouseOk(result, "scroll");
      return `Scrolled ${mouseAction.replace("_", " ")}`;
    }
    const button =
      data?.button === "right" || data?.button === "middle"
        ? data.button
        : "left";
    const result = await mouseClickNative({
      x: point.x,
      y: point.y,
      button,
      double: mouseAction === "double_click",
    });
    assertMouseOk(result, "click");
    return mouseAction === "double_click" ? "Double-clicked" : "Clicked";
  }

  if (keys) {
    const clipboardOp = /^\^[cvcx]$/i.test(keys.trim());
    const { detail } = await retryDesktopKeys({
      keys,
      beforeObserve,
      strictVerify: !clipboardOp,
    });
    return detail;
  }

  if (sequence.length > 0) {
    const steps: Array<{ type: "keys"; value: string; delayMs?: number }> = [];
    for (const s of sequence) {
      if (!s || typeof s !== "object") continue;
      const value = String((s as { value?: unknown }).value ?? "");
      if (!value) continue;
      const delayMs =
        typeof (s as { delayMs?: unknown }).delayMs === "number"
          ? (s as { delayMs?: number }).delayMs
          : undefined;
      steps.push({ type: "keys", value, delayMs });
    }
    if (steps.length > 0) {
      const clipboardOp =
        steps.some((s) => /^\^v$/i.test(s.value)) ||
        (steps.some((s) => /^\^c$/i.test(s.value)) &&
          steps.some((s) => /^\^a$/i.test(s.value))) ||
        (steps.some((s) => /^\^x$/i.test(s.value)) &&
          steps.some((s) => /^\^a$/i.test(s.value)));
      const { detail } = await retryDesktopKeys({
        steps,
        beforeObserve,
        strictVerify: !clipboardOp,
      });
      return detail;
    }
  }

  if (replaceAll && text.trim()) {
    await restoreFocusContext();
    await new Promise((r) => setTimeout(r, 120));
    await runInputSequenceNative({
      steps: [
        { type: "keys", value: "^a", delayMs: 40 },
        { type: "keys", value: "{BACKSPACE}", delayMs: 40 },
      ],
      delayMs: 80,
    });
    const msg = await smartInsertText(text, { ...data, replaceAll: false });
    return finishTypingResult(msg, beforeObserve, text, true);
  }

  if (prefocusKeys.trim() && text.trim()) {
    await restoreFocusContext();
    await new Promise((r) => setTimeout(r, 120));
    const { detail } = await retryDesktopKeys({
      keys: prefocusKeys,
      beforeObserve,
      strictVerify: false,
    });
    void detail;
    await new Promise((r) => setTimeout(r, 180));
    const msg = await smartInsertText(text, data);
    return finishTypingResult(msg, beforeObserve, text, true);
  }

  if (isContextualWhatsAppComposeCommand()) {
    const body = text.trim() || getLastVoiceCommand()?.trim() || "";
    if (!body) throw new Error("No message text for WhatsApp compose");
    console.info("[ripple-desktop] INSERT_TEXT → WhatsApp open-chat compose");
    await restoreFocusContext();
    await new Promise((r) => setTimeout(r, 400));
    return replaceWhatsAppComposerViaExtension(body);
  }

  if (isWhatsAppMessagingCommand() && extractContactName()) {
    console.info("[ripple-desktop] INSERT_TEXT → WhatsApp CDP (contact in command)");
    return runWhatsAppMessageFlow({
      text,
      recipient:
        (typeof data?.recipient === "string" ? data.recipient : null) ??
        extractContactName() ??
        undefined,
    });
  }

  const msg = await smartInsertText(text, data);
  if (/^Gmail compose opened\b/i.test(msg)) {
    return msg;
  }
  return finishTypingResult(msg, beforeObserve, text, true);
}

async function finishTypingResult(
  message: string,
  beforeObserve: Awaited<ReturnType<typeof captureObservation>>,
  expectedText?: string,
  strict = false,
): Promise<string> {
  const verified = await verifyTypingObservation({
    before: beforeObserve,
    expectedText,
    settleMs: 220,
  });
  if (!verified.ok) {
    console.warn(
      `[ripple-desktop] typing observe: ${verified.reason ?? "failed"} fg=${verified.after.foreground?.processName ?? "?"}`,
    );
    if (strict) {
      throw new Error(`Typing verification failed: ${verified.reason ?? "unknown"}`);
    }
  }
  return message;
}

function assertMouseOk(
  result: { ok: boolean } | null,
  action: string,
): asserts result is { ok: boolean } {
  if (!result?.ok) {
    throw new Error(
      `Mouse ${action} failed: native sidecar unavailable, elevation blocked, or coordinates invalid`,
    );
  }
}

async function resolveMousePoint(
  data: Record<string, unknown> | undefined,
  target: FocusContext | null,
): Promise<{ x: number; y: number }> {
  const ex = typeof data?.x === "number" ? data.x : undefined;
  const ey = typeof data?.y === "number" ? data.y : undefined;
  if (ex !== undefined && ey !== undefined) return { x: ex, y: ey };
  const under = await getWindowUnderCursorNative();
  if (under?.hwnd && !isWeakFocusContext(under)) {
    const underCenter = await getWindowRectCenter(under.hwnd);
    if (underCenter) return underCenter;
  }
  if (target?.hwnd) {
    const c = await getWindowRectCenter(target.hwnd);
    if (c) return c;
  }
  const center = await getWindowCenterNative();
  if (center) return center;
  throw new Error("Could not resolve mouse coordinates");
}
