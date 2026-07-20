import { describe, expect, it } from "vitest";
import { LAST_WORD_DURATION, lastWordDuration, wordEnd } from "../src/time";

const ws = (...ts: number[]) => ts.map((t) => ({ timestamp: t, text: "x" }));
const seg = (...ts: number[]) => ({ words: ws(...ts) });

describe("lastWordDuration", () => {
  it("falls back to the constant when there is nothing to measure", () => {
    expect(lastWordDuration([])).toBe(LAST_WORD_DURATION);
    expect(lastWordDuration([seg()])).toBe(LAST_WORD_DURATION);
    expect(lastWordDuration([seg(1)])).toBe(LAST_WORD_DURATION);
  });

  it("takes the middle gap when there is an odd number", () => {
    // gaps 1, 5, 2 -> median 2
    expect(lastWordDuration([seg(0, 1, 6, 8)])).toBe(2);
  });

  it("averages the middle two gaps when there is an even number", () => {
    // gaps 1, 5 -> median 3
    expect(lastWordDuration([seg(0, 1, 6)])).toBe(3);
  });

  it("pools gaps across every segment in the file", () => {
    // gaps 1, 1 from the first segment and 7 from the second -> median 1,
    // where measuring the second segment alone would give 7.
    expect(lastWordDuration([seg(0, 1, 2), seg(10, 17)])).toBe(1);
  });

  it("ignores segment boundaries rather than treating them as gaps", () => {
    // the 100s jump between the two segments is not a word duration
    expect(lastWordDuration([seg(0, 1), seg(101, 102)])).toBe(1);
  });

  it("shrugs off a single long pause, where a mean would not", () => {
    // gaps .2 .2 .2 10 -> median .2 (mean would be 2.65)
    expect(lastWordDuration([seg(0, 0.2, 0.4, 0.6, 10.6)])).toBeCloseTo(0.2);
  });

  it("leaves the caller's words alone", () => {
    const s = seg(0, 5, 6);
    lastWordDuration([s]);
    expect(s.words.map((x) => x.timestamp)).toEqual([0, 5, 6]);
  });
});

describe("wordEnd", () => {
  it("uses the next timestamp, and the given duration only for the final word", () => {
    const w = ws(0, 1, 6);
    expect(wordEnd(w, 0, 3)).toBe(1);
    expect(wordEnd(w, 1, 3)).toBe(6);
    expect(wordEnd(w, 2, 3)).toBe(9);
  });
});
