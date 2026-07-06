import { randomUUID } from "node:crypto";
import type { CommandResultPayload } from "../../automation/types.js";
import { commandPayloadFromIntent } from "../../automation/desktop/desktopCommand.js";
import type { NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import type { DesktopInputParsed } from "../types.js";
import {
  buildTypingPayload,
  insertTextDataFromInput,
  insertTextDataFromTypeIntent,
} from "../typingPayload.js";
import type { ExecutionPlan, PlanStep } from "./planTypes.js";

export function insertDataFromPlanStep(step: PlanStep): Record<string, unknown> | null {
  switch (step.tool) {
    case "desktop.type_text":
      return {
        text: step.args.text,
        ...(step.args.replaceAll ? { replaceAll: true } : {}),
        ...(step.args.prefocusKeys ? { prefocusKeys: step.args.prefocusKeys } : {}),
      };
    case "desktop.press_keys":
      if (Array.isArray(step.args.sequence)) {
        return { sequence: step.args.sequence };
      }
      return { keys: step.args.keys };
    case "desktop.copy":
      return { keys: "^c" };
    case "desktop.paste":
      return { keys: "^v" };
    case "desktop.select_all":
      return { keys: "^a" };
    case "desktop.mouse_click":
      return {
        mouseAction: step.args.double ? "double_click" : "click",
        ...(typeof step.args.x === "number" ? { x: step.args.x } : {}),
        ...(typeof step.args.y === "number" ? { y: step.args.y } : {}),
        ...(typeof step.args.button === "string" ? { button: step.args.button } : {}),
      };
    case "desktop.mouse_move":
      if (step.args.moveToCenter) {
        return {
          mouseAction: "move_to_center",
          ...(typeof step.args.offsetX === "number"
            ? { offsetX: step.args.offsetX }
            : {}),
        };
      }
      if (typeof step.args.x === "number" && typeof step.args.y === "number") {
        return {
          mouseAction: "move_absolute",
          x: step.args.x,
          y: step.args.y,
        };
      }
      return {
        mouseAction: "move",
        deltaX: step.args.deltaX ?? 0,
        deltaY: step.args.deltaY ?? 0,
      };
    case "desktop.mouse_scroll": {
      const direction = String(step.args.direction ?? "down").toLowerCase();
      return {
        mouseAction: direction === "up" ? "scroll_up" : "scroll_down",
        ...(typeof step.args.x === "number" ? { x: step.args.x } : {}),
        ...(typeof step.args.y === "number" ? { y: step.args.y } : {}),
        ...(typeof step.args.amount === "number" ? { scrollDelta: step.args.amount } : {}),
      };
    }
    case "desktop.mouse_drag":
      return {
        mouseAction: "drag",
        ...(typeof step.args.shape === "string" ? { shape: step.args.shape } : {}),
        ...(typeof step.args.radius === "number" ? { radius: step.args.radius } : {}),
        ...(typeof step.args.length === "number" ? { length: step.args.length } : {}),
        ...(step.args.moveToCenter === true ? { moveToCenter: true } : {}),
        ...(typeof step.args.offsetX === "number"
          ? { offsetX: step.args.offsetX }
          : {}),
        ...(typeof step.args.x === "number" ? { x: step.args.x } : {}),
        ...(typeof step.args.y === "number" ? { y: step.args.y } : {}),
      };
    case "desktop.paint_op":
      return {
        mouseAction: "paint_op",
        op: step.args.op,
        ...(typeof step.args.text === "string" ? { text: step.args.text } : {}),
      };
    default:
      return null;
  }
}

/** Map a plan step to P7 action data (typing bridge or tool-executor marker). */
function planStepToActionData(step: PlanStep): Record<string, unknown> | null {
  const bridged = insertDataFromPlanStep(step);
  if (bridged) return bridged;

  if (step.tool === "desktop.launch_app") {
    if (step.args._desktopPayload) {
      return { _desktopPayload: step.args._desktopPayload };
    }
    if (step.args._nativeIntent) {
      return { _nativeIntent: step.args._nativeIntent };
    }
    if (typeof step.args.app === "string") {
      return { launchApp: step.args.app };
    }
  }

  if (
    step.tool.startsWith("filesystem.") ||
    step.tool.startsWith("system.") ||
    step.tool.startsWith("browser.") ||
    step.tool === "desktop.save_file" ||
    step.tool === "desktop.focus_window" ||
    step.tool === "desktop.close_window"
  ) {
    return { _p85Tool: step.tool, ...step.args };
  }

  return null;
}

function shellWorkflowPayload(
  command: string,
  actionData: Record<string, unknown>[],
): CommandResultPayload {
  return {
    command_id: randomUUID(),
    intent: actionData.length > 1 ? "workflow" : "workflow",
    output_type: "action",
    actions: actionData.map((data) => ({
      type: "INSERT_TEXT" as const,
      status: "pending" as const,
      data,
    })),
  };
}
/** True when a plan step can be bridged to P7 INSERT_TEXT actions. */
export function isBridgedPlanStep(step: PlanStep): boolean {
  if (step.tool === "desktop.launch_app") return true;
  if (step.tool === "desktop.focus_window" || step.tool === "desktop.close_window") {
    return true;
  }
  if (step.tool.startsWith("filesystem.") || step.tool.startsWith("system.")) {
    return true;
  }
  if (step.tool === "desktop.save_file") {
    return true;
  }
  if (step.tool.startsWith("browser.")) {
    return true;
  }
  return insertDataFromPlanStep(step) !== null;
}

/** P8.5i — convert validated ExecutionPlan → existing CommandResultPayload. */
export function executionPlanToPayload(
  plan: ExecutionPlan,
  command: string,
): CommandResultPayload | null {
  if (plan.steps.length === 0) return null;

  const first = plan.steps[0];
  if (!first) return null;

  if (plan.steps.length === 1 && first.tool === "desktop.launch_app") {
    if (first.args._desktopPayload) {
      return first.args._desktopPayload as CommandResultPayload;
    }
    if (first.args._nativeIntent) {
      return commandPayloadFromIntent(
        first.args._nativeIntent as NativeCommandIntent,
        command,
        " (p85-l0)",
      );
    }
  }

  if (plan.steps.length === 1) {
    const insertOnly = insertDataFromPlanStep(first);
    if (insertOnly) {
      return buildTypingPayload(command, insertOnly, " (p85)");
    }
    const data = planStepToActionData(first);
    if (data) {
      return shellWorkflowPayload(command, [data]);
    }
  }

  const actions = plan.steps
    .map((step) => {
      const data = planStepToActionData(step);
      if (!data) return null;
      return {
        type: "INSERT_TEXT" as const,
        status: "pending" as const,
        data,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  if (actions.length === 0) return null;

  if (actions.length === 1) {
    return {
      command_id: randomUUID(),
      intent: "typing",
      output_type: "action",
      actions,
    };
  }

  return {
    command_id: randomUUID(),
    intent: "workflow",
    output_type: "action",
    actions,
  };
}

/** Bridge for legacy UniversalPlanResult paths. */
export function parsedInputToPayload(
  command: string,
  parsed: DesktopInputParsed,
): CommandResultPayload {
  return buildTypingPayload(command, insertTextDataFromInput(parsed), " (p85)");
}

export function typeIntentToPayload(
  command: string,
  intent: Parameters<typeof insertTextDataFromTypeIntent>[0],
): CommandResultPayload {
  return buildTypingPayload(
    command,
    insertTextDataFromTypeIntent(intent),
    " (p85)",
  );
}
