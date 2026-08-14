import { hideOverlayToPinnedTarget } from "../../windows/overlay.js";
import { runWhatsAppMessageFlow } from "../adapters/whatsapp/whatsappAdapter.js";
import {
  extractContactName,
  isWhatsAppMessagingCommand,
} from "../adapters/whatsapp/parseContact.js";
import { isContextualWhatsAppComposeCommand } from "../adapters/whatsapp/parseWhatsAppCommand.js";
import { insertWhatsAppComposeText } from "../adapters/whatsapp/whatsappComposeInsert.js";
import { insertBrowserChatComposeText } from "../adapters/browser/browserChatComposeInsert.js";
import { insertInstagramComposeText } from "../adapters/instagram/instagramComposeInsert.js";
import type { FocusContext } from "../../focus/focusContext.js";
import {
  isGoogleChatTabActive,
  isInstagramTabActive,
  isWeakFocusContext,
  restoreFocusContext,
  resolveTypingFocusTarget,
} from "../../focus/focusContext.js";
import { isEditOrRephraseCommand } from "../commandIntent.js";
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
  getWindowRectNative,
  getWindowUnderCursorNative,
} from "../../native/win32Bridge.js";
import { captureObservation, verifyTypingObservation } from "../../agent/observe.js";
import { retryInsertAfterVerifyFail } from "../input/inputStrategy.js";
import { retryDesktopKeys } from "../../agent/retryTyping.js";
import {
  logInsertTextDiagnostics,
  logVerificationFailure,
} from "./insertTextDiagnostics.js";
import {
  drawShapeInMspaint,
  fillShapeInMspaint,
  clearPaintCanvas,
  eraseInMspaint,
  labelTextInMspaint,
  shouldUsePaintShapeDraw,
  paintCanvasMetrics,
} from "../desktop/paintShapeDraw.js";

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

  await logInsertTextDiagnostics("entry", {
    textPreview: text,
    keys: keys || undefined,
    mouseAction: mouseAction || undefined,
    sequenceSteps: sequence.length || undefined,
  });

  // Claim pin then hide — never hide first (shell vacuum).
  await hideOverlayToPinnedTarget();

  let beforeObserve: Awaited<ReturnType<typeof captureObservation>> | undefined;
  if (hasKeyInput || mouseAction) {
    beforeObserve = await captureObservation();
  }

  if (mouseAction) {
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
    if (mouseAction === "paint_op") {
      const op = String(data?.op ?? "");
      if (op === "fill") return fillShapeInMspaint();
      if (op === "erase") return eraseInMspaint();
      if (op === "clear") return clearPaintCanvas();
      if (op === "label") {
        const labelText = typeof data?.text === "string" ? data.text.trim() : "";
        if (!labelText) throw new Error("paint label requires text");
        return labelTextInMspaint(labelText);
      }
      throw new Error(`Unknown paint operation: ${op}`);
    }
    if (mouseAction === "drag") {
      const shape = String(data?.shape ?? "line");
      const radius = typeof data?.radius === "number" ? data.radius : 64;
      const length = typeof data?.length === "number" ? data.length : 120;
      const paintTarget = resolveTypingFocusTarget();
      if (
        paintTarget?.processName &&
        shouldUsePaintShapeDraw(paintTarget.processName)
      ) {
        return drawShapeInMspaint({
          shape,
          radius,
          length,
          offsetX: typeof data?.offsetX === "number" ? data.offsetX : 0,
        });
      }

      const center = await resolveMousePoint(data, target);
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
    const clipboardOp = /^\^[acvx]$/i.test(keys.trim());
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
    await logInsertTextDiagnostics("pre_insert", { textPreview: text });
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
    await logInsertTextDiagnostics("pre_insert", { textPreview: text });
    const msg = await smartInsertText(text, data);
    return finishTypingResult(msg, beforeObserve, text, true);
  }

  {
    const { getActiveNoteId } = await import("../../state/activeNoteFocus.js");
    if (getActiveNoteId()) {
      // Note path is handled in commandOrchestrator — never fall through to WA.
      throw new Error(
        "INSERT_TEXT refused: active Flow Note should use note-compose path",
      );
    }
  }

  // Cold-start: refuse OS insert with no non-Ripple target (avoids keys_landed_in_ripple).
  // Dedicated WA/IG compose paths still run below once sticky/live focus exists.
  {
    const { hasDictationInsertTarget, recoverDictationFocusTarget } =
      await import("../../focus/focusContext.js");
    if (!hasDictationInsertTarget()) {
      const recovered = await recoverDictationFocusTarget("insert_text");
      if (!recovered) {
        throw new Error(
          "no_focus_target — click an editable field (WhatsApp, Notepad, …) then try again",
        );
      }
    }
  }

  if (isContextualWhatsAppComposeCommand()) {
    const body = text.trim() || getLastVoiceCommand()?.trim() || "";
    if (!body) throw new Error("No message text for WhatsApp compose");
    console.info(
      "[ripple-desktop] INSERT_TEXT → WhatsApp open-chat compose (OS-first)",
    );
    return insertWhatsAppComposeText(body);
  }

  if (isGoogleChatTabActive() && text.trim()) {
    console.info(
      "[ripple-desktop] INSERT_TEXT → Google Chat compose (OS-first)",
    );
    return insertBrowserChatComposeText(text.trim());
  }

  if (
    isInstagramTabActive() &&
    !isEditOrRephraseCommand(getLastVoiceCommand() ?? "")
  ) {
    const body = text.trim() || getLastVoiceCommand()?.trim() || "";
    if (!body) throw new Error("No message text for Instagram compose");
    console.info(
      "[ripple-desktop] INSERT_TEXT → Instagram open-chat compose (OS-first)",
    );
    return insertInstagramComposeText(body);
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

  if (text.trim()) {
    const paintTarget = resolveTypingFocusTarget();
    if (paintTarget?.processName && shouldUsePaintShapeDraw(paintTarget.processName)) {
      return labelTextInMspaint(text.trim());
    }
  }

  await logInsertTextDiagnostics("pre_insert", { textPreview: text });
  const { prepareDictationInsertFocus } = await import("../../focus/focusContext.js");
  if (!(await prepareDictationInsertFocus())) {
    throw new Error(
      "insert_aborted:no_focus_target — click the target field and try again",
    );
  }
  beforeObserve = await captureObservation();
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
    logVerificationFailure(verified, expectedText);
    await logInsertTextDiagnostics("verify_fail", { textPreview: expectedText });
    console.warn(
      `[ripple-desktop] typing observe: ${verified.reason ?? "failed"} fg=${verified.after.foreground?.processName ?? "?"}`,
    );
    // Reasons where a11y verification is known to be unreliable even though
    // the insert actually landed correctly (web composers reporting only a
    // placeholder name, or benign same-app foreground churn from an
    // IntelliSense/format popup). Ladder already reported Typed/Pasted —
    // retrying here re-emits the full string (seen live as "I want to meet
    // you tomorrow." typed twice), so for these specific reasons only we
    // accept without retry.
    const verifyUnreliableHere = verified.reason === "a11y_name_mismatch";
    if (verifyUnreliableHere && /typed|pasted/i.test(message)) {
      console.warn(
        "[ripple-desktop] typing observe failed after successful insert — skipping retry to avoid duplicate",
      );
      return message;
    }
    // Bug fix — any other verify failure (e.g. focus_not_editable: keys/paste
    // landed on a non-editable control such as the Windows shell/search
    // flyout, or keys_landed_in_ripple) must not be silently reported as
    // success just because the ladder's own message string says "Typed"/
    // "Pasted". Do not retry here either (same duplicate risk as above) —
    // surface it honestly as a failure instead of a false OK.
    if (/typed|pasted/i.test(message)) {
      throw new Error(
        `insert_unverified:${verified.reason ?? "unknown"} — text may not have reached the intended field`,
      );
    }
    if (strict && expectedText?.trim()) {
      const recovered = await retryInsertAfterVerifyFail(
        expectedText,
        "sendkeys",
        beforeObserve,
      );
      if (recovered) {
        const reverify = await verifyTypingObservation({
          before: beforeObserve,
          expectedText,
          settleMs: 220,
        });
        if (reverify.ok) {
          return recovered.detail;
        }
      }
    }
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

  const offsetX = typeof data?.offsetX === "number" ? data.offsetX : 0;
  if (data?.moveToCenter && target?.hwnd) {
    const proc = (target.processName ?? "").toLowerCase();
    if (shouldUsePaintShapeDraw(proc)) {
      const rect = await getWindowRectNative(target.hwnd);
      if (rect) {
        const canvas = paintCanvasMetrics(rect);
        return { x: canvas.centerX + offsetX, y: canvas.centerY };
      }
    }
  }

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
