import { describe, expect, it } from "vitest";
import {
  applyVariableRecognition,
  extractCodeIdentifiers,
} from "../variableRecognition.js";

const SAMPLE = `
export function authCheck(userId: string) {
  const isLoginError = false;
  let my_script_name = 1;
  return isLoginError || my_script_name > 0;
}
`;

describe("extractCodeIdentifiers", () => {
  it("pulls camelCase and snake_case symbols", () => {
    const ids = extractCodeIdentifiers(SAMPLE);
    expect(ids).toContain("isLoginError");
    expect(ids).toContain("my_script_name");
    expect(ids).toContain("authCheck");
  });
});

describe("applyVariableRecognition", () => {
  it("no-ops outside IDE apps", () => {
    const out = applyVariableRecognition(
      "variable is login error is false",
      "notepad",
      SAMPLE,
    );
    expect(out.text).toBe("variable is login error is false");
  });

  it("rewrites spoken words to camelCase identifier", () => {
    const out = applyVariableRecognition(
      "variable is login error is false by default",
      "cursor",
      SAMPLE,
    );
    expect(out.text).toContain("isLoginError");
    expect(out.text).not.toMatch(/\bis login error\b/i);
  });

  it("rewrites spoken snake_case via words", () => {
    const out = applyVariableRecognition(
      "increment my script name",
      "cursor",
      SAMPLE,
    );
    expect(out.text).toContain("my_script_name");
  });

  it("uses identifiers from a named workspace file, not only the open tab", () => {
    const out = applyVariableRecognition(
      "in overlay.ts variable is login error is false",
      "cursor",
      SAMPLE,
    );
    expect(out.text).toContain("isLoginError");
  });
});
