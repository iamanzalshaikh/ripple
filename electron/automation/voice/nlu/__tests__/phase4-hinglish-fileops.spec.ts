import { describe, expect, it } from "vitest";
import { normalizeHinglishSlots } from "../../i18n/hinglishSlots.js";
import { parseFileOperationCommand } from "../../../desktop/parseFileOperationCommand.js";
import { parseDesktopIntent } from "../pipeline.js";
import { preprocessForNlu } from "../preprocess.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("hinglishSlots", () => {
  it.each([
    [
      "Downloads mein folder banao naam user",
      "create folder in downloads, named user",
    ],
    [
      "downloads mein file banao naam notes.txt",
      "create file in downloads, named notes.txt",
    ],
    [
      "folder banao downloads mein naam test",
      "create folder in downloads, named test",
    ],
    [
      "create folder downloads mein naam ripple",
      "create folder in downloads, named ripple",
    ],
    [
      "documents mein user naam ka folder banao",
      "create folder in documents, named user",
    ],
  ])('"%s"', (input, expected) => {
    const { nlu } = preprocessForNlu(input);
    expect(nlu.toLowerCase()).toMatch(/create (folder|file) in (downloads|documents)/);
    expect(nlu.toLowerCase()).toMatch(/named (user|test|ripple|notes\.txt)/);
  });
});

describe("Hinglish file operations — pipeline", () => {
  it.each([
    ["Downloads mein folder banao naam user", "create_folder", "user", "downloads"],
    ["Downloads mein file banao naam todo.txt", "create_file", "todo.txt", "downloads"],
    ["डाउनलोड में फोल्डर बनाओ, नाम user", "create_folder", "user", "downloads"],
    ["क्रिएट फोल्डर इन डाउनलोड नेम फ्लो", "create_folder", "फ्लो", "downloads"],
    ["क्रिएट करो फोल्डर डाउनलोड में नाम फ्लो", "create_folder", "फ्लो", "downloads"],
    ["Delete temp.txt kar do", "delete_file", "temp.txt", undefined],
    ["temp.txt delete karo", "delete_file", "temp.txt", undefined],
  ])(
    '"%s" → %s',
    (phrase, kind, name, parent) => {
      const result = parseDesktopIntent(phrase);
      expect(result?.intent.kind).toBe(kind);
      if (result?.intent.kind === "create_folder" || result?.intent.kind === "create_file") {
        expect(result.intent.name.toLowerCase()).toContain(name.toLowerCase());
        if (parent) expect(result.intent.parent).toBe(parent);
      }
      if (result?.intent.kind === "delete_file") {
        expect(result.intent.sourceName.toLowerCase()).toContain(name.toLowerCase());
      }
    },
  );
});

describe("Hinglish compound fix", () => {
  it('normalizes "download kholo phir resume kholo"', () => {
    const { nlu } = preprocessForNlu("Download kholo phir resume kholo");
    expect(nlu.toLowerCase()).not.toContain("open open");
    expect(nlu.toLowerCase()).toMatch(/open downloads/);
    expect(nlu.toLowerCase()).toMatch(/then open/);
  });
});

describe("parseFileOperationCommand via slotNormalize", () => {
  it("preserves folder words inside named slot", () => {
    const { nlu } = preprocessForNlu("Create new folder named Downloads Info");
    expect(nlu).toBe("Create new folder named Downloads Info");
    const result = parseDesktopIntent("Create new folder named Downloads Info");
    expect(result?.intent.kind).toBe("create_folder");
    if (result?.intent.kind === "create_folder") {
      expect(result.intent.name).toBe("Downloads Info");
    }
  });
});
