import { describe, expect, it } from "vitest";
import { assignLanes } from "../src/lanes";
import { LAST_WORD_DURATION, lastWordDuration } from "../src/time";

const seg = (key: number, times: number[]) => ({
  key,
  words: times.map((t) => ({ timestamp: t, text: "w" })),
});

describe("assignLanes", () => {
  it("shares one lane for non-overlapping segments (alternating speakers)", () => {
    const a = seg(1, [0, 0.5]); // last word runs the given duration (0.5) past 0.5 -> ends 1.0
    const b = seg(2, [1.5, 2.0]);
    const { lane, count } = assignLanes([a, b], 0.5);
    expect(count).toBe(1);
    expect(lane.get(1)).toBe(0);
    expect(lane.get(2)).toBe(0);
  });

  it("stacks overlapping segments", () => {
    const a = seg(1, [0, 2]);
    const b = seg(2, [1, 3]); // overlaps a
    const dur = lastWordDuration([a, b]); // gaps 2, 2 -> 2
    const c = seg(3, [2 + dur + 0.01]); // after a ends
    const { lane, count } = assignLanes([a, b, c], dur);
    expect(count).toBe(2);
    expect(lane.get(1)).toBe(0);
    expect(lane.get(2)).toBe(1);
    expect(lane.get(3)).toBe(0); // reuses top lane
  });

  it("handles empty input", () => {
    expect(assignLanes([], LAST_WORD_DURATION).count).toBe(1);
  });
});
