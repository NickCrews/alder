import { segStart, segEnd } from "./time";
import type { Word } from "./types";

export interface LaneAssignment {
  /** segment key -> lane index (0 = top) */
  lane: Map<number, number>;
  count: number;
}

/** Greedy interval packing: sort by start, place each segment in the lowest
 * lane whose previous occupant has already ended. */
export function assignLanes(
  segments: readonly { key: number; words: Word[] }[],
  lastDur: number,
): LaneAssignment {
  const order = [...segments].sort((a, b) => segStart(a) - segStart(b));
  const laneEnds: number[] = [];
  const lane = new Map<number, number>();
  for (const s of order) {
    const start = segStart(s);
    let li = laneEnds.findIndex((end) => end <= start + 1e-6);
    if (li === -1) {
      li = laneEnds.length;
      laneEnds.push(segEnd(s, lastDur));
    } else {
      laneEnds[li] = segEnd(s, lastDur);
    }
    lane.set(s.key, li);
  }
  return { lane, count: Math.max(laneEnds.length, 1) };
}
