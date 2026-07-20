import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { AnnotationState } from "../types";
import { createAnnotatorStore } from "../store";
import { createPlayer } from "../player";
import { clamp } from "../time";
import { runsToHtml, runsToText } from "../clipboard";
import { ensureStyles } from "../ensureStyles";
import type { Ctx, Guide, Viewport } from "./ctx";
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
  const [guide, setGuide] = createSignal<Guide | null>(null);
  let bodyRef: HTMLDivElement | undefined;

  const setView = (v: Viewport) => {
    const dur = clamp(v.dur, MIN_VIEW_DUR, duration);
    setViewRaw({ start: clamp(v.start, 0, duration - dur), dur });
  };
  const scale = () => width() / view().dur;
  const x = (t: number) => (t - view().start) * scale();
  const timeAt = (px: number) => view().start + px / scale();

  const ctx: Ctx = {
    store,
    player,
    view,
    setView,
    guide,
    setGuide,
    width,
    duration,
    x,
    timeAt,
    scale,
  };

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

  const isEditableTarget = (e: Event) =>
    (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]") !=
    null;

  /** ⌘C writes the clipboard directly: writing needs only a user gesture, and
   * it's the one API that carries both flavors. (Reading is the gated
   * direction — hence the `paste` listener below rather than `readText`.) */
  function copySelection() {
    const runs = store.copyRuns();
    if (!runs.length) return false;
    const items: Record<string, Blob> = {
      "text/plain": new Blob([runsToText(runs)], { type: "text/plain" }),
    };
    // Only worth labeling when whole segments are in play; otherwise the HTML
    // says nothing the plain text doesn't.
    if (runs.some((r) => r.label)) {
      items["text/html"] = new Blob([runsToHtml(runs)], { type: "text/html" });
    }
    void navigator.clipboard?.write?.([new ClipboardItem(items)]).catch(() => {});
    return true;
  }

  /** ⌘V arrives as a real paste event — it bubbles to `document` even with
   * focus on `<body>`, giving us the data synchronously and with no permission
   * prompt, which `navigator.clipboard.readText()` cannot do. */
  function onPaste(e: ClipboardEvent) {
    if (isEditableTarget(e)) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    store.pasteText(text, player.time());
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isEditableTarget(e)) return;
    if (e.key === " ") {
      e.preventDefault();
      player.toggle();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      // Nothing selected: leave the keystroke to the browser.
      if (copySelection()) e.preventDefault();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (!store.selection()) return;
      e.preventDefault();
      store.deleteSelection();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (!store.selection()) return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      if (e.shiftKey) store.extendSelection(dir);
      else store.selectAdjacentWord(dir);
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
    document.addEventListener("paste", onPaste);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPaste);
    });
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
        <Show when={guide()}>
          {(g) => (
            <div class="pointer-events-none absolute inset-y-0 z-30">
              <div
                class="absolute inset-y-0 bg-sky-300/10"
                style={{
                  left: `${x(g().start)}px`,
                  width: `${Math.max(x(g().end) - x(g().start), 0)}px`,
                }}
              />
              <div
                class="absolute inset-y-0 w-px bg-sky-300"
                style={{ left: `${x(g().start)}px` }}
              />
              <div
                class="absolute inset-y-0 w-px bg-sky-300/60"
                style={{ left: `${x(g().end)}px` }}
              />
              <div
                class="absolute top-0 rounded-br-sm bg-sky-300 px-1 font-mono text-[10px] text-zinc-900 tabular-nums"
                style={{ left: `${x(g().start)}px` }}
              >
                {g().start.toFixed(2)}s
              </div>
            </div>
          )}
        </Show>
      </div>
      <SelectionBar ctx={ctx} />
    </div>
  );
}
