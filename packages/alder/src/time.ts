import type { Word } from "./types";

/** Visual/derived duration of a segment's final word (seconds). */
export const LAST_WORD_DURATION = 0.4;

/** Minimum spacing enforced between adjacent word timestamps when dragging. */
export const MIN_GAP = 0.02;

export function wordEnd(words: Word[], i: number): number {
  return i < words.length - 1
    ? words[i + 1].timestamp
    : words[i].timestamp + LAST_WORD_DURATION;
}

export function segStart(seg: { words: Word[] }): number {
  return seg.words[0]?.timestamp ?? 0;
}

export function segEnd(seg: { words: Word[] }): number {
  return seg.words.length ? wordEnd(seg.words, seg.words.length - 1) : 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
