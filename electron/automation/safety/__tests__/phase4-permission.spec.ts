import { describe, expect, it } from "vitest";
import { permissionForCommand } from "../permissionEngine.js";
import {
  commandTextFromPayload,
  getPermissionBlockMessage,
} from "../permissionGate.js";
import { permissionForDesktopKind } from "../../tools/toolRegistry.js";

describe("P4.6 — permission engine", () => {
  it("blocks bulk delete", () => {
    expect(permissionForCommand("delete all PDFs").level).toBe("blocked");
  });

  it("blocks Hindi bulk delete", () => {
    expect(permissionForCommand("sab pdf delete karo").level).toBe("blocked");
  });

  it("blocks format drive", () => {
    expect(permissionForCommand("format D drive").level).toBe("blocked");
  });

  it("blocks kill all", () => {
    expect(permissionForCommand("close all chrome windows").level).toBe(
      "blocked",
    );
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

  it("blocks WhatsApp without contact in speech", () => {
    expect(permissionForCommand("send on whatsapp").level).toBe("blocked");
  });

  it("blocks WhatsApp payload missing recipient", () => {
    const payload = {
      command_id: "x",
      intent: "workflow",
      output_type: "workflow",
      actions: [
        {
          type: "WORKFLOW",
          status: "pending",
          data: {
            steps: [
              {
                type: "INSERT_TEXT",
                status: "pending",
                data: {
                  _whatsappBatch: true,
                  text: "hello",
                  send: true,
                  command: "send hello on whatsapp",
                },
              },
            ],
          },
        },
      ],
    };
    expect(permissionForCommand("send hello on whatsapp", payload).level).toBe(
      "blocked",
    );
  });

  it("allows single-contact WhatsApp payload", () => {
    const payload = {
      command_id: "x",
      intent: "workflow",
      output_type: "workflow",
      actions: [
        {
          type: "WORKFLOW",
          status: "pending",
          data: {
            steps: [
              {
                type: "INSERT_TEXT",
                status: "pending",
                data: {
                  _whatsappBatch: true,
                  recipient: "Saad",
                  text: "hello",
                  send: true,
                  command: "message Saad hello on whatsapp",
                },
              },
            ],
          },
        },
      ],
    };
    expect(
      permissionForCommand("message Saad hello on whatsapp", payload).level,
    ).toBe("allowed");
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
            steps: [
              {
                type: "NOOP",
                status: "pending",
                data: { desktopKind: "delete_file", command: "delete temp.txt" },
              },
            ],
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

  it("allows open folder", () => {
    expect(permissionForCommand("open downloads").level).toBe("allowed");
  });
});

describe("P4.6 — permission gate helpers", () => {
  it("extracts command text from workflow steps", () => {
    const payload = {
      command_id: "x",
      actions: [
        {
          type: "WORKFLOW",
          status: "pending",
          data: {
            steps: [
              {
                type: "NOOP",
                status: "pending",
                data: { command: "open downloads" },
              },
            ],
          },
        },
      ],
    };
    expect(commandTextFromPayload(payload, "fallback")).toBe("open downloads");
  });

  it("getPermissionBlockMessage records blocked bulk delete", () => {
    const msg = getPermissionBlockMessage("delete all files");
    expect(msg).toMatch(/bulk delete/i);
  });
});

describe("P4.6 — toolRegistry permission map", () => {
  it("maps destructive desktop kinds to confirm", () => {
    expect(permissionForDesktopKind("delete_file")).toBe("confirm");
    expect(permissionForDesktopKind("move_file")).toBe("confirm");
    expect(permissionForDesktopKind("folder")).toBe("allowed");
  });
});
