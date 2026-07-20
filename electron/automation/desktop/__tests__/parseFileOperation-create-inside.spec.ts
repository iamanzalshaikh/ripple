import { describe, expect, it } from "vitest";
import { parseFileOperationCommand } from "../parseFileOperationCommand.js";
import { parseSaveFileCommand } from "../parseSaveFileCommand.js";
import { classifyClause } from "../../../agent/planner/v2/clauseClassifier.js";

/**
 * Wave 0 T6 — create file/folder with "inside" / "in" must split name vs parent.
 * Live bug: parseSaveFileCommand stole create-file → desktop.save_file with
 * filename="test.txt inside C:\\Ripple-Test.txt".
 */
describe("Wave 0 T6 — create file/folder inside parent", () => {
  it("create a file called notes.txt inside Documents", () => {
    expect(
      parseFileOperationCommand(
        "Create a file called notes.txt inside Documents",
      ),
    ).toEqual({
      kind: "create_file",
      name: "notes.txt",
      parent: "documents",
    });
  });

  it("create a file called sales.txt inside absolute path", () => {
    expect(
      parseFileOperationCommand(
        "Create a file called sales.txt inside C:\\Ripple-Test\\W0\\Source\\Reports\\Q1",
      ),
    ).toEqual({
      kind: "create_file",
      name: "sales.txt",
      parent: "C:\\Ripple-Test\\W0\\Source\\Reports\\Q1",
    });
  });

  it("create file called report1.txt inside Reports (absolute)", () => {
    expect(
      parseFileOperationCommand(
        "Create a file called report1.txt inside C:\\Ripple-Test\\W0\\Source\\Reports",
      ),
    ).toEqual({
      kind: "create_file",
      name: "report1.txt",
      parent: "C:\\Ripple-Test\\W0\\Source\\Reports",
    });
  });

  it("create folder called W0 inside Ripple-Test path", () => {
    expect(
      parseFileOperationCommand(
        "Create a folder called W0 inside C:\\Ripple-Test",
      ),
    ).toEqual({
      kind: "create_folder",
      name: "W0",
      parent: "C:\\Ripple-Test",
    });
  });

  it("create folder on C drive", () => {
    expect(
      parseFileOperationCommand("Create a folder called Ripple-Test on C drive"),
    ).toEqual({
      kind: "create_folder",
      name: "Ripple-Test",
      parent: "C:\\",
    });
  });

  it("create file with path that contains spaces", () => {
    expect(
      parseFileOperationCommand(
        "Create a file called notes.txt inside C:\\Users\\ANZAL\\Desktop\\Test 2",
      ),
    ).toEqual({
      kind: "create_file",
      name: "notes.txt",
      parent: "C:\\Users\\ANZAL\\Desktop\\Test 2",
    });
  });

  it("save parser must not claim filesystem create-inside phrases", () => {
    expect(
      parseSaveFileCommand(
        "Create a file called test.txt inside C:\\Ripple-Test",
      ),
    ).toBeNull();
  });

  it("planner-v2 classifies create-inside as FILE_MUTATE not SAVE_FILE", () => {
    const rec = classifyClause(
      "Create a file called test.txt inside C:\\Ripple-Test",
      0,
    );
    expect(rec.clauseType).toBe("FILE_MUTATE");
    expect(rec.parseSource).toBe("parseFileOperationCommand");
  });
});
