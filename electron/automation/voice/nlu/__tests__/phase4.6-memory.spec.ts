import { describe, expect, it } from "vitest";
import { parseAliasMetaCommand } from "../../../desktop/parseAliasCommand.js";
import { parseReferentialRecall } from "../referentialParse.js";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Phase 4.6 — session memory & aliases", () => {
  it.each([
    ["Open it again", "auto"],
    ["Same file again", "file"],
    ["That folder again", "folder"],
    ["Go back", "parent"],
    ["Open that project", "folder"],
    ["Bring it back", "auto"],
    ["Dubara kholo", "auto"],
    ["Phir se open karo", "auto"],
    ["Woh project kholo", "folder"],
    ["फिर से खोलो", "auto"],
    ["Open last pdf", "pdf"],
    ["Open last pdf I opened", "pdf"],
    ["Open lastpdf I opened", "pdf"],
    ["Open the pdf I had open", "pdf"],
    ["Open last video I opened", "video"],
    ["Open last image I opened", "image"],
    ["Open last file", "file"],
    ["Open last folder", "folder"],
    ["Open last folder I opened", "folder"],
  ])('recall "%s" → target:%s', (cmd, target) => {
    const result = parseDesktopIntent(cmd);
    expect(result?.intent.kind).toBe("recall_memory");
    if (result?.intent.kind === "recall_memory") {
      expect(result.intent.target).toBe(target);
    }
  });

  it("pipeline parses open it again", () => {
    const result = parseDesktopIntent("Open it again");
    expect(result?.intent.kind).toBe("recall_memory");
  });

  it("list aliases meta command", () => {
    expect(parseAliasMetaCommand("List my aliases")?.kind).toBe("list_aliases");
  });

  it("remember alias command shape", () => {
    const intent = parseAliasMetaCommand(
      "Remember portfolio is D:\\Projects\\Portfolio",
    );
    expect(intent?.kind).toBe("remember_alias");
    if (intent?.kind === "remember_alias") {
      expect(intent.name).toMatch(/portfolio/i);
    }
  });

  it("remember test is in downloads uses alias name test", () => {
    const intent = parseAliasMetaCommand("Remember test is in downloads");
    expect(intent?.kind).toBe("remember_alias");
    if (intent?.kind === "remember_alias") {
      expect(intent.name).toBe("test");
    }
  });
});
