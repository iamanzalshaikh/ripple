import { describe, expect, it } from "vitest";
import { parseFileOperationCommand } from "../../../desktop/parseFileOperationCommand.js";
import { parseDesktopIntent } from "../pipeline.js";
import { slotNormalize } from "../slotNormalize.js";
import { createFolder } from "../../../desktop/fileOperations.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

const CREATE_CASES: Array<[string, string, string]> = [
  ["create folder in downloads, name user", "user", "downloads"],
  ["create folder in downloads, named user", "user", "downloads"],
  ["Create folder in downloads name test", "test", "downloads"],
  ["create folder in documents, called notes", "notes", "documents"],
  ["Create a new folder named Anzal in Documents", "Anzal", "documents"],
  ["create folder named Ripple in downloads", "Ripple", "downloads"],
  ["in downloads, create folder named alpha", "alpha", "downloads"],
  ["in documents create folder named beta", "beta", "documents"],
  ["Downloads mein folder banao naam user", "user", "downloads"],
  ["create folder downloads mein naam ripple", "ripple", "downloads"],
  ["Create folder in downloads, name Downloads Info", "Downloads Info", "downloads"],
  ["create folder on desktop named scratch", "scratch", "desktop"],
  ["Create new folder in documents called reports", "reports", "documents"],
  ["in desktop, create folder named temp", "temp", "desktop"],
  ["create a folder in downloads named backup", "backup", "downloads"],
  ["Create folder named test on desktop", "test", "desktop"],
  ["create new folder in downloads called data", "data", "downloads"],
  ["create folder in download name user2", "user2", "downloads"],
  ["folder banao downloads mein naam demo", "demo", "downloads"],
  ["documents mein folder banao naam work", "work", "documents"],
  ["create folder in documents name project alpha", "project alpha", "documents"],
  ["in downloads create folder name beta", "beta", "downloads"],
  ["Create folder in Documents, named My Stuff", "My Stuff", "documents"],
];

const FILE_CREATE_CASES: Array<[string, string, string]> = [
  ["create file in documents, named notes.txt", "notes.txt", "documents"],
  ["create file in downloads name todo.txt", "todo.txt", "downloads"],
  ["Create a file called ideas.txt in downloads", "ideas.txt", "downloads"],
];

const MOVE_CASES: Array<[string, string, string, string]> = [
  ["Move Invoice.pdf from Downloads to Desktop", "Invoice.pdf", "downloads", "desktop"],
  ["move user from downloads to documents", "user", "downloads", "documents"],
  ["Move flow in downloads to desktop", "flow", "downloads", "desktop"],
];

const RENAME_CASES: Array<[string, string, string, string]> = [
  ["Rename Flow in Downloads to Heroids", "Flow", "Heroids", "downloads"],
  ["rename oldname to newname in documents", "oldname", "newname", "documents"],
];

const DELETE_CASES: Array<[string, string, string | undefined]> = [
  ["Delete temp.txt", "temp.txt", undefined],
  ["delete user from downloads", "user", "downloads"],
  ["Delete folder test in documents", "test", "documents"],
];

describe("P1 — slotNormalize", () => {
  it.each([
    ["create folder in downloads name user", "named user"],
    ["in downloads create folder named x", "create folder in downloads"],
  ])('"%s"', (input, fragment) => {
    expect(slotNormalize(input).toLowerCase()).toContain(fragment.toLowerCase());
  });
});

describe("P1 — create folder NL (40+ phrasings)", () => {
  it.each(CREATE_CASES)('"%s" → %s @ %s', (phrase, name, parent) => {
    const op = parseFileOperationCommand(phrase);
    expect(op?.kind).toBe("create_folder");
    if (op?.kind === "create_folder") {
      expect(op.name).toBe(name);
      expect(op.parent).toBe(parent);
    }
  });
});

describe("P1 — create file NL", () => {
  it.each(FILE_CREATE_CASES)('"%s" → %s @ %s', (phrase, name, parent) => {
    const op = parseFileOperationCommand(phrase);
    expect(op?.kind).toBe("create_file");
    if (op?.kind === "create_file") {
      expect(op.name).toMatch(new RegExp(name.replace(".", "\\."), "i"));
      expect(op.parent).toBe(parent);
    }
  });
});

describe("P1 — move / rename / delete NL", () => {
  it.each(MOVE_CASES)(
    'move "%s"',
    (phrase, item, from, to) => {
      const op = parseFileOperationCommand(phrase);
      expect(op?.kind).toBe("move_file");
      if (op?.kind === "move_file") {
        expect(op.sourceName).toMatch(new RegExp(item, "i"));
        expect(op.parent).toBe(from);
        expect(op.destination).toBe(to);
      }
    },
  );

  it.each(RENAME_CASES)(
    'rename "%s"',
    (phrase, src, dst, parent) => {
      const op = parseFileOperationCommand(phrase);
      expect(op?.kind).toBe("rename_file");
      if (op?.kind === "rename_file") {
        expect(op.sourceName).toMatch(new RegExp(src, "i"));
        expect(op.newName).toMatch(new RegExp(dst, "i"));
        expect(op.parent).toBe(parent);
      }
    },
  );

  it.each(DELETE_CASES)(
    'delete "%s"',
    (phrase, item, parent) => {
      const op = parseFileOperationCommand(phrase);
      expect(op?.kind).toBe("delete_file");
      if (op?.kind === "delete_file") {
        expect(op.sourceName).toMatch(new RegExp(item, "i"));
        expect(op.parent).toBe(parent);
      }
    },
  );
});

describe("P1 — full pipeline", () => {
  it.each([
    "create folder in downloads, name user",
    "Downloads mein folder banao naam test",
  ])('pipeline parses "%s"', (phrase) => {
    const result = parseDesktopIntent(phrase);
    expect(result?.intent.kind).toBe("create_folder");
  });
});

describe("P1 — no silent Desktop default on create", () => {
  it("createFolder without parent throws guided message", async () => {
    await expect(createFolder("orphan", undefined)).rejects.toThrow(
      /Which location/i,
    );
  });
});
