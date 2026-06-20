import { describe, expect, it } from "vitest";
import { permissionForCommand } from "../permissionEngine.js";

describe("permissionEngine", () => {
  it("blocks bulk delete", () => {
    const r = permissionForCommand("delete all PDFs");
    expect(r.level).toBe("blocked");
  });

  it("blocks format drive", () => {
    const r = permissionForCommand("format D drive");
    expect(r.level).toBe("blocked");
  });

  it("blocks kill all", () => {
    const r = permissionForCommand("close all chrome windows");
    expect(r.level).toBe("blocked");
  });

  it("blocks wildcard delete", () => {
    expect(permissionForCommand("delete *.pdf").level).toBe("blocked");
  });

  it("blocks system paths", () => {
    expect(permissionForCommand("delete C:\\Windows\\System32").level).toBe(
      "blocked",
    );
  });

  it("blocks WhatsApp broadcast", () => {
    expect(permissionForCommand("send to everyone on whatsapp").level).toBe(
      "blocked",
    );
  });

  it("confirms delete_file payload", () => {
    const r = permissionForCommand("delete temp.txt", {
      command_id: "x",
      intent: "workflow",
      output_type: "workflow",
      actions: [
        {
          type: "WORKFLOW",
          status: "pending",
          data: {
            steps: [{ type: "NOOP", status: "pending", data: { desktopKind: "delete_file" } }],
          },
        },
      ],
    });
    expect(r.level).toBe("confirm");
  });

  it("confirms workflows over 10 steps", () => {
    const steps = Array.from({ length: 11 }, () => ({
      type: "NOOP" as const,
      status: "pending" as const,
      data: { desktopKind: "folder" },
    }));
    const r = permissionForCommand("big workflow", {
      command_id: "x",
      intent: "workflow",
      output_type: "workflow",
      actions: [{ type: "WORKFLOW", status: "pending", data: { steps } }],
    });
    expect(r.level).toBe("confirm");
  });
});
