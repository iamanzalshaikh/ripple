import { describe, expect, it } from "vitest";
import { buildReferentialSendMessage } from "../executeReferentialSend.js";
import { buildDesktopCommandResult } from "../../../desktop/desktopCommand.js";
import { resolveKnownItemPath } from "../../../desktop/openDesktopItem.js";

describe("buildReferentialSendMessage", () => {
  it("includes basename and full path in message", () => {
    const msg = buildReferentialSendMessage("C:\\Users\\test\\Downloads\\Anzal");
    expect(msg).toContain("Anzal");
    expect(msg).toContain("C:\\Users\\test\\Downloads\\Anzal");
    expect(msg).toMatch(/Here is the (file|folder):/);
  });
});

describe("compound send sourcePath chaining", () => {
  it("embeds resolved item path on referential_send batch", () => {
    const path = resolveKnownItemPath("Anzal", "downloads");
    if (!path) return;

    const result = buildDesktopCommandResult(
      "Send Anzal folder from downloads to Dr. Fatima",
    );
    const steps = result?.actions[0]?.data?.steps as
      | Array<{ data?: { sourcePath?: string; desktopKind?: string } }>
      | undefined;
    expect(steps).toHaveLength(2);
    expect(steps?.[1]?.data?.desktopKind).toBe("referential_send");
    expect(steps?.[1]?.data?.sourcePath).toBe(path);
  });
});
