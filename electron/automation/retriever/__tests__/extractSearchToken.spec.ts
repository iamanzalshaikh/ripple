import { describe, expect, it } from "vitest";
import {
  extractSearchToken,
  widenSearchTokens,
} from "../extractSearchToken.js";

describe("extractSearchToken", () => {
  it("parses English open phrasing", () => {
    expect(extractSearchToken("open my resume")).toBe("resume");
  });

  it("parses Hinglish phrasing", () => {
    expect(extractSearchToken("mera resume kholo")).toBe("resume");
    expect(extractSearchToken("download kholo")).toBe("download");
  });

  it("widens tokens from phrase", () => {
    const tokens = widenSearchTokens("open my resume pdf");
    expect(tokens).toContain("resume");
  });
});
