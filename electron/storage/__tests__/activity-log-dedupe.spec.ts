import { beforeEach, describe, expect, it } from "vitest";
import {
  appendActivityLog,
  clearActivityLog,
  listRecentActivity,
} from "../activityLog.js";

beforeEach(() => {
  clearActivityLog();
});

describe("activity_log dedupe (P8)", () => {
  it("skips repeated viewed logs for same path within window", () => {
    const path = "C:\\Users\\test\\photo.png";
    appendActivityLog({
      path,
      command: "viewed image (focus-title)",
      summary: "photo.png",
    });
    appendActivityLog({
      path,
      command: "viewed image (focus-title)",
      summary: "photo.png",
    });
    appendActivityLog({
      path,
      command: "viewed image (focus-url)",
      summary: "photo.png",
    });

    expect(listRecentActivity(10)).toHaveLength(1);
  });

  it("logs again when command differs materially", () => {
    const path = "C:\\Users\\test\\doc.pdf";
    appendActivityLog({
      path,
      command: "viewed pdf (focus-title)",
      summary: "doc.pdf",
    });
    appendActivityLog({
      path,
      command: "open doc.pdf",
      summary: "doc.pdf",
    });

    expect(listRecentActivity(10)).toHaveLength(2);
  });
});
