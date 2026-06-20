import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareWhatsAppAttachment } from "../whatsappAttachment.js";

describe("prepareWhatsAppAttachment", () => {
  it("returns base64 payload for small files", () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-wa-"));
    const filePath = join(dir, "test.png");
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const payload = prepareWhatsAppAttachment(filePath);
    expect(payload?.fileName).toBe("test.png");
    expect(payload?.mimeType).toBe("image/png");
    expect(payload?.base64.length).toBeGreaterThan(4);
  });

  it("returns null for missing paths", () => {
    expect(prepareWhatsAppAttachment("Z:\\no-such-file.bin")).toBeNull();
  });
});
