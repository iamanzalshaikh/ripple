import { describe, expect, it } from "vitest";
import {
  buildDesktopCommandResult,
  commandPayloadFromIntent,
} from "../../automation/desktop/desktopCommand.js";
import { filesystemPlanFromDesktopPayload } from "../planner/desktopPayloadToFilesystem.js";

describe("P8.5 desktop payload → filesystem plan", () => {
  it("maps delete_file WORKFLOW to filesystem.delete", () => {
    const payload = commandPayloadFromIntent(
      {
        kind: "delete_file",
        sourceName: "notes",
        parent: "downloads",
      },
      "delete notes in downloads",
      "",
    );
    const plan = filesystemPlanFromDesktopPayload(
      payload,
      "delete notes in downloads",
      "delete notes in downloads",
    );
    expect(plan?.steps[0]?.tool).toBe("filesystem.delete");
    expect(plan?.steps[0]?.args.sourceName).toBe("notes");
    expect(plan?.steps[0]?.args.parentFolder).toBe("downloads");
    expect(plan?.steps[0]?.args._desktopPayload).toBeUndefined();
  });

  it("maps create_folder WORKFLOW to filesystem.create_folder", () => {
    const payload = commandPayloadFromIntent(
      {
        kind: "create_folder",
        name: "projects",
        parent: "documents",
      },
      "create folder projects in documents",
      "",
    );
    const plan = filesystemPlanFromDesktopPayload(
      payload,
      "create folder projects in documents",
      "create folder projects in documents",
    );
    expect(plan?.steps[0]?.tool).toBe("filesystem.create_folder");
    expect(plan?.steps[0]?.args.folderName).toBe("projects");
    expect(plan?.steps[0]?.args.parentFolder).toBe("documents");
  });

  it("returns null for compound workflows", () => {
    const payload = buildDesktopCommandResult("open notepad and type hello");
    expect(payload?.actions?.length).toBeGreaterThan(0);
    expect(
      filesystemPlanFromDesktopPayload(
        payload!,
        "open notepad and type hello",
        "open notepad and type hello",
      ),
    ).toBeNull();
  });
});
