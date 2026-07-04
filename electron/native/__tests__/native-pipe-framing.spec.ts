import { describe, expect, it } from "vitest";
import {
  encodePipeFrame,
  PipeFrameReader,
} from "../nativePipeFraming.js";

describe("nativePipeFraming", () => {
  it("round-trips length-prefixed JSON frames", () => {
    const reader = new PipeFrameReader();
    const frame = encodePipeFrame({
      id: "1",
      method: "ping",
      params: {},
    });
    const parts = [frame.subarray(0, 3), frame.subarray(3)];
    const first = reader.push(parts[0]);
    expect(first).toHaveLength(0);
    const second = reader.push(parts[1]);
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual({ id: "1", method: "ping", params: {} });
  });
});
