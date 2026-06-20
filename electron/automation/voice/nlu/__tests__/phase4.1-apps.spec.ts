import { describe, expect, it } from "vitest";
import { parseNativeAppCommand } from "../../../desktop/parseNativeAppCommand.js";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Phase 4.1 — native app control", () => {
  it.each([
    ["Open calculator", "launch_app", "calculator"],
    ["Launch notepad", "launch_app", "notepad"],
    ["Start paint", "launch_app", "paint"],
    ["Open VS Code", "launch_app", "vscode"],
    ["Open cursor", "launch_app", "cursor"],
    ["Open spotify", "launch_app", "spotify"],
    ["Open task manager", "launch_app", "task-manager"],
    ["Open file explorer", "launch_app", "file-explorer"],
  ])('"%s" → %s (%s)', (cmd, kind, appId) => {
    const intent = parseNativeAppCommand(cmd);
    expect(intent?.kind).toBe(kind);
    if (intent && "app" in intent) {
      expect(intent.app.id).toBe(appId);
    }
  });

  it.each([
    ["Switch to VS Code", "switch_app", "vscode"],
    ["Focus chrome", "switch_app", "chrome"],
    ["Go to discord", "switch_app", "discord"],
  ])('"%s" → %s', (cmd, kind, appId) => {
    const intent = parseNativeAppCommand(cmd);
    expect(intent?.kind).toBe(kind);
    if (intent && "app" in intent) {
      expect(intent.app.id).toBe(appId);
    }
  });

  it.each([
    ["Close chrome", "close_app", "chrome"],
    ["Quit spotify", "close_app", "spotify"],
  ])('"%s" → %s', (cmd, kind, appId) => {
    const intent = parseNativeAppCommand(cmd);
    expect(intent?.kind).toBe(kind);
    if (intent && "app" in intent) {
      expect(intent.app.id).toBe(appId);
    }
  });

  it("minimize all windows", () => {
    expect(parseNativeAppCommand("Minimize all windows")?.kind).toBe(
      "minimize_all",
    );
  });

  it("does not treat web-only whatsapp as native app", () => {
    expect(parseNativeAppCommand("Open whatsapp")).toBeNull();
  });

  it("does not treat downloads folder as app name", () => {
    expect(parseNativeAppCommand("Open downloads")).toBeNull();
  });

  it("pipeline resolves Bhai VS Code kholo via NLU", () => {
    const result = parseDesktopIntent("Bhai VS Code kholo");
    expect(result?.intent.kind).toBe("launch_app");
  });
});
