import type { Accessor } from "solid-js";
import type { AnnotatorStore } from "../store";
import type { Player } from "../player";

export interface Viewport {
  /** Left edge of the visible window, seconds. */
  start: number;
  /** Visible duration, seconds. */
  dur: number;
}

/** The span of an in-progress drag, drawn as full-height rules over the timeline. */
export interface Guide {
  start: number;
  end: number;
}

/** Shared plumbing threaded through the annotator UI. */
export interface Ctx {
  store: AnnotatorStore;
  player: Player;
  view: Accessor<Viewport>;
  setView: (v: Viewport) => void;
  /** Set while dragging so the edges can be lined up against the waveform. */
  guide: Accessor<Guide | null>;
  setGuide: (g: Guide | null) => void;
  width: Accessor<number>;
  duration: number;
  /** time (s) -> px within the timeline area */
  x: (t: number) => number;
  /** px -> time (s) */
  timeAt: (px: number) => number;
  /** px per second */
  scale: () => number;
}
