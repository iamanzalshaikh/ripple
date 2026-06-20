import { describe, expect, it } from "vitest";
import { parseSystemActionCommand } from "../../../desktop/parseSystemActionCommand.js";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Phase 4.4 — system actions", () => {
  it.each([
    ["Lock my PC", "lock_pc"],
    ["Open bluetooth settings", "open_bluetooth_settings"],
    ["Open wifi settings", "open_network_settings"],
    ["Open control panel", "open_control_panel"],
    ["Open settings", "open_settings"],
  ])('"%s" → %s', (cmd, action) => {
    const intent = parseSystemActionCommand(cmd);
    expect(intent?.kind).toBe("system_action");
    if (intent?.kind === "system_action") {
      expect(intent.action).toBe(action);
    }
  });

  it("pipeline resolves lock command", () => {
    const result = parseDesktopIntent("Lock my computer");
    expect(result?.intent.kind).toBe("system_action");
  });
});
