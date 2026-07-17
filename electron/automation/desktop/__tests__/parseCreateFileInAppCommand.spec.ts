import { describe, expect, it } from "vitest";
import {
  inferEditorProjectPath,
  inferEditorProjectPathFromDevCwd,
  parseCreateFileInAppCommand,
  resolveEditorWorkspace,
} from "../parseCreateFileInAppCommand.js";

describe("parseCreateFileInAppCommand", () => {
  it("parses create file api.ts in cursor", () => {
    const intent = parseCreateFileInAppCommand("Create file api.ts in cursor");
    expect(intent).toEqual({
      kind: "create_file_in_app",
      filename: "api.ts",
      application: "cursor",
    });
  });

  it("parses create a new file, server.js in cursor", () => {
    const intent = parseCreateFileInAppCommand(
      "Create a new file, server.js in cursor",
    );
    expect(intent).toEqual({
      kind: "create_file_in_app",
      filename: "server.js",
      application: "cursor",
    });
  });

  it("repairs server.jsin cursor glitch from translation", () => {
    const intent = parseCreateFileInAppCommand(
      "Create a new file, server.jsin cursor",
    );
    expect(intent?.filename).toBe("server.js");
    expect(intent?.application).toBe("cursor");
  });

  it("parses create new file server.js in cursor without comma", () => {
    const intent = parseCreateFileInAppCommand(
      "create new file server.js in cursor",
    );
    expect(intent?.filename).toBe("server.js");
    expect(intent?.application).toBe("cursor");
  });

  it("maps vs code to cursor", () => {
    const intent = parseCreateFileInAppCommand(
      "create file notes.txt in vs code",
    );
    expect(intent?.application).toBe("cursor");
  });

  it("returns null for unrelated commands", () => {
    expect(parseCreateFileInAppCommand("list files in downloads")).toBeNull();
  });
});

describe("inferEditorProjectPath", () => {
  it("extracts project folder from Cursor window title", () => {
    expect(
      inferEditorProjectPath("QueryProvider.tsx - projectRipple - Cursor"),
    ).toMatch(/projectRipple$/);
  });
});

describe("resolveEditorWorkspace", () => {
  it("falls back to dev cwd when titles are weak", () => {
    const ws = resolveEditorWorkspace(["Cursor", null, ""]);
    expect(ws).toBeTruthy();
    expect(inferEditorProjectPathFromDevCwd()).toBe(ws);
  });

  it("prefers title match over cwd fallback", () => {
    const ws = resolveEditorWorkspace([
      "app.tsx - projectRipple - Cursor",
      "Cursor",
    ]);
    expect(ws).toMatch(/projectRipple$/);
  });
});
