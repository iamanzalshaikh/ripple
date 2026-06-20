import { describe, expect, it } from "vitest";
import { parseFileOperationCommand } from "../parseFileOperationCommand.js";

describe("parseFileOperationCommand location-first", () => {
  it("parses create folder in downloads, name user", () => {
    const r = parseFileOperationCommand("create folder in downloads, name user");
    expect(r).toEqual({
      kind: "create_folder",
      name: "user",
      parent: "downloads",
    });
  });

  it("parses create file in documents named notes.txt", () => {
    const r = parseFileOperationCommand(
      "create file in documents, named notes.txt",
    );
    expect(r).toEqual({
      kind: "create_file",
      name: "notes.txt",
      parent: "documents",
    });
  });

  it("parses create a new folder named X in location", () => {
    const r = parseFileOperationCommand(
      "Create a new folder named Anzal in Documents",
    );
    expect(r).toEqual({
      kind: "create_folder",
      name: "Anzal",
      parent: "documents",
    });
  });
});
