import { describe, expect, it } from "vitest";
import { assignLanes } from "../src/lanes";
import { LAST_WORD_DURATION } from "../src/time";

const seg = (key: number, times: number[]) => ({
  key,
  words: times.map((t) => ({ timestamp: t, text: "w" })),
});

describe("assignLanes", () => {
  it("shares one lane for non-overlapping segments (alternating speakers)", () => {
    const a = seg(1, [0, 0.5]); // ends 0.5 + LAST_WORD_DURATION = 0.9
    const b = seg(2, [1.0, 1.5]);
    const { lane, count } = assignLanes([a, b]);
    expect(count).toBe(1);
    expect(lane.get(1)).toBe(0);
    expect(lane.get(2)).toBe(0);
  });

  it("stacks overlapping segments", () => {
    const a = seg(1, [0, 2]);
    const b = seg(2, [1, 3]); // overlaps a
    const c = seg(3, [2 + LAST_WORD_DURATION + 0.01]); // after a ends
    const { lane, count } = assignLanes([a, b, c]);
    expect(count).toBe(2);
    expect(lane.get(1)).toBe(0);
    expect(lane.get(2)).toBe(1);
    expect(lane.get(3)).toBe(0); // reuses top lane
  });

  it("handles empty input", () => {
    expect(assignLanes([]).count).toBe(1);
  });
});
