import { describe, expect, it } from "vitest";
import { getCompoundParts } from "../../../../agent/planner/utteranceClassifier.js";
import {
  splitCompoundParts,
  stripCommandFillers,
} from "../compoundParse.js";
import { normalizeTranscript } from "../../normalizeTranscript.js";

describe("compound filler strip", () => {
  it("removes and second before select", () => {
    expect(
      stripCommandFillers(
        "open notepad, write hello world and second, select all and copy",
      ),
    ).toBe("open notepad, write hello world, select all and copy");
  });

  it("replaces after that before select", () => {
    expect(
      stripCommandFillers(
        "open notepad, type hello world after that select all and copy",
      ),
    ).toBe("open notepad, type hello world, select all and copy");
  });

  it("splits three clauses after filler strip", () => {
    const parts = splitCompoundParts(
      "Open notepad, write hello world and second, select all and copy",
    );
    expect(parts).toEqual([
      "Open notepad",
      "write hello world",
      "select all and copy",
    ]);
  });

  it("getCompoundParts matches planner entry path", () => {
    const raw =
      "Open notepad, write hello world and second, select all and copy";
    const transcript = normalizeTranscript(raw);
    expect(stripCommandFillers(transcript)).toContain("select all and copy");
    const parts = getCompoundParts(raw, raw.toLowerCase());
    expect(parts).toEqual([
      "Open notepad",
      "write hello world",
      "select all and copy",
    ]);
  });
});
