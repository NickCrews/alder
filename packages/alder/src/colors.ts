import type { Speaker } from "./types";

const PALETTE = [
  "#f43f5e", // rose
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#84cc16", // lime
  "#06b6d4", // cyan
];

/** Color for a speaker, keyed by position in the speakers array. */
export function speakerColor(speakers: readonly Speaker[], speakerId: number): string {
  const idx = speakers.findIndex((s) => s.id === speakerId);
  return PALETTE[(idx >= 0 ? idx : speakerId) % PALETTE.length];
}
