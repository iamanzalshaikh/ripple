import { describe, expect, it } from "vitest";
import {
  extractContactName,
  extractMessageFromCommand,
} from "../parseContact.js";

describe("parseContact — titled names", () => {
  it('parses "Message Dr. Fatima and say, How are you"', () => {
    const cmd = "Message Dr. Fatima and say, How are you";
    expect(extractContactName(cmd)).toBe("Dr. Fatima");
    expect(extractMessageFromCommand(cmd)).toBe("How are you");
  });

  it('parses "Message Dr Fatima say hello"', () => {
    const cmd = "Message Dr Fatima say hello";
    expect(extractContactName(cmd)).toBe("Dr. Fatima");
    expect(extractMessageFromCommand(cmd)).toBe("hello");
  });

  it('does not split "Dr." from "Fatima" as contact/message', () => {
    const cmd = "Message Dr. Fatima and say, How are you";
    expect(extractContactName(cmd)).not.toBe("Dr");
    expect(extractMessageFromCommand(cmd)).not.toMatch(/^Fatima/i);
  });

  it("maps Urdu Dr Fatima to WhatsApp search name", () => {
    const cmd = "سرچ ڈاکٹر فاطمہ اور پوچھو سکتے ہیں کہ آپ کیسے ہیں";
    expect(extractContactName(cmd)).toBe("Dr. Fatima");
    expect(extractMessageFromCommand(cmd)?.length).toBeGreaterThan(0);
  });
});
