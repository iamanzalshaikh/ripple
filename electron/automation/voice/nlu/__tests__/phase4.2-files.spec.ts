import { describe, expect, it } from "vitest";
import { parseFileOperationCommand } from "../../../desktop/parseFileOperationCommand.js";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Phase 4.2 — folders & file operations", () => {
  it.each([
    ["Open Downloads", "folder", "downloads"],
    ["Open Documents", "folder", "documents"],
    ["Open Desktop", "folder", "desktop"],
    ["Open my downloads", "folder", "downloads"],
  ])('"%s" → %s (%s)', (cmd, kind, folder) => {
    const result = parseDesktopIntent(cmd);
    expect(result?.intent.kind).toBe(kind);
    if (result?.intent.kind === "folder") {
      expect(result.intent.folder).toBe(folder);
    }
  });

  it("create folder in downloads", () => {
    const op = parseFileOperationCommand(
      "Create a folder called Ripple Notes in Downloads",
    );
    expect(op?.kind).toBe("create_folder");
    if (op?.kind === "create_folder") {
      expect(op.name).toMatch(/ripple notes/i);
      expect(op.parent).toBe("downloads");
    }
  });

  it("create file", () => {
    const op = parseFileOperationCommand("Create a file called ideas.txt");
    expect(op?.kind).toBe("create_file");
    if (op?.kind === "create_file") {
      expect(op.name).toMatch(/ideas\.txt/i);
    }
  });

  it("rename file in location", () => {
    const op = parseFileOperationCommand(
      "Rename Flow in Downloads to Heroids",
    );
    expect(op?.kind).toBe("rename_file");
    if (op?.kind === "rename_file") {
      expect(op.sourceName).toMatch(/flow/i);
      expect(op.newName).toMatch(/heroids/i);
      expect(op.parent).toBe("downloads");
    }
  });

  it("move file between folders", () => {
    const op = parseFileOperationCommand(
      "Move Invoice.pdf from Downloads to Desktop",
    );
    expect(op?.kind).toBe("move_file");
    if (op?.kind === "move_file") {
      expect(op.sourceName).toMatch(/invoice/i);
      expect(op.destination).toBe("desktop");
      expect(op.parent).toBe("downloads");
    }
  });

  it("delete file", () => {
    const op = parseFileOperationCommand("Delete temp.txt");
    expect(op?.kind).toBe("delete_file");
    if (op?.kind === "delete_file") {
      expect(op.sourceName).toMatch(/temp/i);
    }
  });

  it("open named item via pipeline", () => {
    const result = parseDesktopIntent("Open Resume.pdf");
    expect(result?.intent.kind).toBe("file");
  });
});
