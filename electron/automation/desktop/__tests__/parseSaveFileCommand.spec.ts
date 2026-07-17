import { describe, expect, it } from "vitest";
import { parseSaveFileCommand } from "../parseSaveFileCommand.js";

describe("parseSaveFileCommand", () => {
  it("parses save the file as with folder", () => {
    const intent = parseSaveFileCommand(
      "save the file as meetingnotes.txt inside documents",
    );
    expect(intent?.kind).toBe("save_file");
    expect(intent?.filename).toBe("meetingnotes.txt");
    expect(intent?.folder).toBe("documents");
  });

  it("parses save as in downloads", () => {
    const intent = parseSaveFileCommand("save as report.txt in downloads");
    expect(intent?.filename).toBe("report.txt");
    expect(intent?.folder).toBe("downloads");
  });

  it("adds .txt when extension missing", () => {
    const intent = parseSaveFileCommand("save as notes in downloads");
    expect(intent?.filename).toBe("notes.txt");
  });

  it("extracts app target from create file command", () => {
    const intent = parseSaveFileCommand("Create new file server.js in cursor");
    expect(intent?.kind).toBe("save_file");
    expect(intent?.filename).toBe("server.js");
    expect(intent?.application).toBe("cursor");
  });
});
