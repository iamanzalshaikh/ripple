import { describe, expect, it } from "vitest";
import { correctWhisperMishearings } from "../sttCorrection.js";
import { processTranscriptFromStt, commandTextFromTranscript } from "../transcriptPipeline.js";
import { parseWorkflowMetaCommand } from "../../desktop/parseWorkflowCommand.js";
import { useFreshNluCache } from "../nlu/__tests__/testHelpers.js";

useFreshNluCache();

describe("sttCorrection — Whisper mishearings", () => {
  it.each([
    [
      "Member work mode, open, calculator, notepad and github",
      "Remember work mode open calculator, notepad and github",
    ],
    [
      "Remember workmode open calculator, notepad and github",
      "Remember work mode open calculator, notepad and github",
    ],
    ["Show me tomorrow's pdf", "Show me today's pdf"],
  ])('"%s"', (input, expected) => {
    expect(correctWhisperMishearings(input)).toBe(expected);
  });
});

describe("transcriptPipeline — remember workflow", () => {
  it("Member work mode → remember_workflow intent", () => {
    const snap = processTranscriptFromStt(
      "Member work mode, open, calculator, notepad and github",
    );
    expect(snap.wasSttCorrected).toBe(true);
    const cmd = commandTextFromTranscript(snap);
    const intent = parseWorkflowMetaCommand(cmd);
    expect(intent?.kind).toBe("remember_workflow");
  });
});
