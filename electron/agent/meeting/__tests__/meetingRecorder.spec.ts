import { describe, expect, it } from "vitest";
import {
  buildMeetingAnalysisBlock,
  computeTalkTime,
  parseMeetingVoiceCommand,
} from "../meetingRecorder.js";

describe("P10.2 meeting voice commands", () => {
  it("matches start variants", () => {
    expect(parseMeetingVoiceCommand("start meeting")).toBe("start");
    expect(parseMeetingVoiceCommand("Begin meeting.")).toBe("start");
    expect(parseMeetingVoiceCommand("record a meeting")).toBe("start");
    expect(parseMeetingVoiceCommand("start meeting notes")).toBe("start");
  });

  it("matches stop variants", () => {
    expect(parseMeetingVoiceCommand("stop meeting")).toBe("stop");
    expect(parseMeetingVoiceCommand("end the meeting")).toBe("stop");
    expect(parseMeetingVoiceCommand("finish recording")).toBe("stop");
  });

  it("ignores unrelated phrases", () => {
    expect(parseMeetingVoiceCommand("open notepad")).toBeNull();
    expect(parseMeetingVoiceCommand("start the car")).toBeNull();
    expect(parseMeetingVoiceCommand("stop watching")).toBeNull();
  });
});

describe("P10.2 meeting analysis formatting", () => {
  it("computes talk-time percentages", () => {
    const rows = computeTalkTime(
      new Map([
        ["Speaker A", 30],
        ["Speaker B", 10],
      ]),
    );
    expect(rows).toEqual([
      { speaker: "Speaker A", seconds: 30, percent: 75 },
      { speaker: "Speaker B", seconds: 10, percent: 25 },
    ]);
  });

  it("builds analysis markdown with all sections", () => {
    const md = buildMeetingAnalysisBlock({
      summary: "Discussed payments and scheduling.",
      sentiment: {
        overall: "tense",
        label: "Tense but productive",
        score: 0.35,
        rationale: "Payment concerns dominated.",
      },
      decisions: ["Meet tomorrow at 9pm"],
      openQuestions: ["Who owns the invoice?"],
      topics: ["payments", "scheduling"],
      keyFacts: ["₹3000 and documents reported missing"],
      actionItems: [
        {
          task: "Clarify client payment process",
          owner: "Speaker A",
          due: "tomorrow",
          confidence: 0.82,
          evidence: "once we will give the payment",
        },
      ],
      talkTime: [
        { speaker: "Speaker A", seconds: 40, percent: 66.7 },
        { speaker: "Speaker B", seconds: 20, percent: 33.3 },
      ],
    });

    expect(md).toContain("## Summary");
    expect(md).toContain("## Sentiment");
    expect(md).toContain("## Decisions");
    expect(md).toContain("## Key facts");
    expect(md).toContain("₹3000");
    expect(md).toContain("## Action items");
    expect(md).toContain("confidence: high (82%)");
    expect(md).toContain("## Open questions");
    expect(md).toContain("## Key topics");
    expect(md).toContain("`payments`");
    expect(md).toContain("## Talk time");
    expect(md).toContain("Speaker A");
  });
});
