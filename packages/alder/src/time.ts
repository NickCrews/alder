import type { Word } from "./types";

/** Duration assumed for a segment's final word while the document holds no
 * pair of adjacent words to measure against (seconds). */
export const LAST_WORD_DURATION = 0.4;

/** Minimum spacing enforced between adjacent word timestamps when dragging. */
export const MIN_GAP = 0.02;

/** Derived duration for a segment's final word, which has no following
 * timestamp to bound it: the median gap between adjacent words across every
 * segment in the document. File-wide rather than per-segment so a one- or
 * two-word segment is sized by the file's rhythm instead of its own noise.
 *
 * The median (not the mean) so that a single long pause mid-segment doesn't
 * drag every trailing word wide. Falls back to LAST_WORD_DURATION for an empty
 * document, where there is nothing yet to measure. */
export function lastWordDuration(segments: readonly { words: Word[] }[]): number {
  const gaps: number[] = [];
  for (const seg of segments) {
    for (let i = 1; i < seg.words.length; i++) {
      gaps.push(seg.words[i].timestamp - seg.words[i - 1].timestamp);
    }
  }
  if (!gaps.length) return LAST_WORD_DURATION;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

export function wordEnd(words: Word[], i: number, lastDur: number): number {
  return i < words.length - 1 ? words[i + 1].timestamp : words[i].timestamp + lastDur;
}

export function segStart(seg: { words: Word[] }): number {
  return seg.words[0]?.timestamp ?? 0;
}

export function segEnd(seg: { words: Word[] }, lastDur: number): number {
  return seg.words.length ? wordEnd(seg.words, seg.words.length - 1, lastDur) : 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
