import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { AnnotationState } from "../types";
import { createAnnotatorStore } from "../store";
import { createPlayer } from "../player";
import { clamp } from "../time";
import { ensureStyles } from "../ensureStyles";
import type { Ctx, Viewport } from "./ctx";
import { Toolbar } from "./Toolbar";
import { SpeakerBar } from "./SpeakerBar";
import { Waveform } from "./Waveform";
import { TrackArea } from "./TrackArea";
import { SelectionBar } from "./SelectionBar";

export interface AnnotatorHandle {
  getState(): AnnotationState;
  /** Replace speakers/segments. Audio is fixed per instance — remount to change it. */
  setState(state: AnnotationState): void;
}

export interface AnnotatorProps {
  initialState: AnnotationState;
  /** Fired with the full annotation after every committed edit. */
  onChange?: (state: AnnotationState) => void;
  ref?: (handle: AnnotatorHandle) => void;
  class?: string;
}

const MIN_VIEW_DUR = 0.05;

export function Annotator(props: AnnotatorProps) {
  ensureStyles();
  // eslint-disable-next-line solid/reactivity -- initialState is intentionally captured once
  const store = createAnnotatorStore(props.initialState, (s) => props.onChange?.(s));
  const player = createPlayer(store.audio, store.sampleRate);
  const duration = Math.max(store.duration, MIN_VIEW_DUR);

  const [view, setViewRaw] = createSignal<Viewport>({ start: 0, dur: duration });
  const [width, setWidth] = createSignal(800);
  let bodyRef: HTMLDivElement | undefined;

  const setView = (v: Viewport) => {
    const dur = clamp(v.dur, MIN_VIEW_DUR, duration);
    setViewRaw({ start: clamp(v.start, 0, duration - dur), dur });
  };
  const scale = () => width() / view().dur;
  const x = (t: number) => (t - view().start) * scale();
  const timeAt = (px: number) => view().start + px / scale();

  const ctx: Ctx = { store, player, view, setView, width, duration, x, timeAt, scale };

  props.ref?.({ getState: store.getState, setState: store.setState });

  onMount(() => {
    if (bodyRef) {
      setWidth(bodyRef.clientWidth || 800);
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => setWidth(bodyRef!.clientWidth || 800));
        ro.observe(bodyRef);
        onCleanup(() => ro.disconnect());
      }
    }
  });
  onCleanup(() => player.destroy());

  // Follow the playhead: shift the view when it runs off the right edge.
  createEffect(() => {
    const t = player.time();
    if (!player.playing()) return;
    const v = view();
    if (t > v.start + v.dur || t < v.start) {
      setView({ start: t - v.dur * 0.1, dur: v.dur });
    }
  });

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const v = view();
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      setView({ start: v.start + e.deltaX / scale(), dur: v.dur });
    } else {
      const anchor = timeAt(e.clientX - rect.left);
      const factor = Math.pow(1.0015, e.deltaY);
      const dur = clamp(v.dur * factor, MIN_VIEW_DUR, duration);
      setView({ start: anchor - (anchor - v.start) * (dur / v.dur), dur });
    }
  }

  const isEditableTarget = (e: KeyboardEvent) =>
    (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]") !=
    null;

  function onKeyDown(e: KeyboardEvent) {
    if (isEditableTarget(e)) return;
    if (e.key === " ") {
      e.preventDefault();
      player.toggle();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const keys = store.selectedSegKeys();
      const sel = store.selection();
      if (!keys.length) return;
      e.preventDefault();
      if (keys.length > 1) store.deleteSegments(keys);
      else if (sel?.wordIdx != null) store.deleteWord(sel.segKey, sel.wordIdx);
      else store.deleteSegments(keys);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (!store.selection()) return;
      e.preventDefault();
      store.selectAdjacentWord(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Enter") {
      const sel = store.selection();
      if (sel?.wordIdx == null) return;
      e.preventDefault();
      store.requestWordEdit(sel.segKey, sel.wordIdx, null);
    } else if (e.key === "Escape") {
      store.setSelection(null);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const sel = store.selection();
      if (sel?.wordIdx == null) return;
      e.preventDefault();
      store.requestWordEdit(sel.segKey, sel.wordIdx, e.key);
    }
  }

  onMount(() => {
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  const playheadX = () => x(player.time());

  return (
    <div
      class={`alder-root flex min-w-0 flex-col gap-2 rounded-lg bg-zinc-900 p-3 font-sans text-sm text-zinc-100 ${props.class ?? ""}`}
    >
      <Toolbar ctx={ctx} />
      <SpeakerBar ctx={ctx} />
      <div ref={bodyRef} class="relative flex min-w-0 flex-col gap-1" onWheel={onWheel}>
        <Waveform ctx={ctx} />
        <TrackArea ctx={ctx} />
        <Show when={playheadX() >= 0 && playheadX() <= width()}>
          <div
            class="pointer-events-none absolute inset-y-0 z-20 w-px bg-red-500"
            style={{ left: `${playheadX()}px` }}
          />
        </Show>
      </div>
      <SelectionBar ctx={ctx} />
    </div>
  );
}
