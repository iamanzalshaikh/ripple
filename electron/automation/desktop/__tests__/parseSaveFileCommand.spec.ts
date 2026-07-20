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

  it("does not steal filesystem create-file with inside path (Wave 0 T6)", () => {
    expect(
      parseSaveFileCommand(
        "Create a file called test.txt inside C:\\Ripple-Test",
      ),
    ).toBeNull();
    expect(
      parseSaveFileCommand(
        "Create a file called notes.txt inside Documents",
      ),
    ).toBeNull();
  });

  it("still parses bare create a file called as save", () => {
    const intent = parseSaveFileCommand("create a file called notes");
    expect(intent?.kind).toBe("save_file");
    expect(intent?.filename).toBe("notes.txt");
  });
});
