import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { AnnotationState } from "../types";
import { createAnnotatorStore } from "../store";
import { urlSource, type AudioSource } from "../audio";
import { clamp, segEnd } from "../time";
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
  /** The transcript to edit. Audio is supplied separately via {@link audioSource}.
   * Omit it (or pass `null`) to start from a blank transcript — audio you
   * haven't transcribed yet is the common case, and callers shouldn't have to
   * spell out what "empty" means. */
  initialState?: AnnotationState | null;
  /** Where the waveform and playback get their audio. Pass a `"https://…"` URL
   * to stream a WAV straight from a static host — the annotator builds it with
   * {@link urlSource} and, since it created that source, destroys it on cleanup.
   * Or pass an {@link AudioSource} you built yourself: `bufferSourceFromBytes`
   * (or `bufferSource`) for samples in memory, `urlSource` for finer control or
   * to share one source between mounts. A source you pass stays yours — the
   * annotator never destroys one it didn't create.
   *
   * Either way the source may still be loading; the annotator doesn't wait on
   * it. See {@link AudioSource} for what that means. */
  audioSource: AudioSource | string;
  /** Fired with the full annotation after every committed edit. */
  onChange?: (state: AnnotationState) => void;
  ref?: (handle: AnnotatorHandle) => void;
  class?: string;
}

const MIN_VIEW_DUR = 0.05;

export function Annotator(props: AnnotatorProps) {
  ensureStyles();

  // eslint-disable-next-line solid/reactivity -- audio is fixed for the life of the instance
  const sourceOrUrl = props.audioSource;
  // A URL string is ours to build and ours to tear down; a source the caller
  // built stays theirs. Either way we have a source right now — one that may
  // still be loading — so there is nothing here to await and nothing to render
  // around. The transcript is editable from the first frame.
  const owned = typeof sourceOrUrl === "string";
  const audio = owned ? urlSource(sourceOrUrl) : sourceOrUrl;
  if (owned) onCleanup(() => audio.destroy());

  // Likewise the transport: a player is bound to the audio, not to its arrival,
  // so the toolbar and keys drive real playback from the start. A seek made
  // while the file is still downloading is where playback begins.
  const player = audio.createPlayer();
  onCleanup(() => player.destroy());

  // eslint-disable-next-line solid/reactivity -- initialState is intentionally captured once
  const store = createAnnotatorStore(props.initialState, {
    // The edit bound is the audio's end and nothing else. It deliberately does
    // *not* use `duration()` below: that includes the transcript's own extent,
    // so clamping against it would let the last word push the bound it's being
    // clamped to, one drag at a time. Unknown (null) means unbounded, which is
    // the honest answer before the audio has told us where the end is.
    audioEnd: audio.duration,
    onChange: (s) => props.onChange?.(s),
  });

  // The timeline's far edge *to draw*. Until audio lands there's still an extent
  // — the end of the last word — so the transcript is fully visible and editable
  // meanwhile; the audio length takes over (whichever is longer) once the header
  // arrives, widening the view reactively.
  const docDuration = createMemo(() => {
    let end = 0;
    for (const seg of store.doc.segments) {
      const e = segEnd(seg, store.lastWordDur());
      if (e > end) end = e;
    }
    return end;
  });
  const duration = createMemo(() =>
    Math.max(audio.duration() ?? 0, docDuration(), MIN_VIEW_DUR),
  );

  // What the auto-fit view fits, held still for the span of an edit. `duration`
  // tracks the document, so without the latch dragging the last word rightward
  // would shrink the pixel scale under the cursor mid-gesture; the fit catches
  // up in one step when the drag ends. (Not read while an op is live, so no
  // subscription to `duration` is taken during the drag either.)
  const fitDuration = createMemo<number>(
    (prev) => (store.opActive() ? prev : duration()),
    duration(),
  );

  const [manualView, setManualView] = createSignal<Viewport | null>(null);
  const [width, setWidth] = createSignal(800);
  const [guide, setGuide] = createSignal<Guide | null>(null);
  let bodyRef: HTMLDivElement | undefined;

  // Until the user pans or zooms, the view auto-fits the whole timeline — so it
  // grows from the transcript's extent to the full clip when audio arrives,
  // rather than staying pinned to a stale window.
  const view = (): Viewport => manualView() ?? { start: 0, dur: fitDuration() };
  const setView = (v: Viewport) => {
    const d = duration();
    const dur = clamp(v.dur, MIN_VIEW_DUR, d);
    setManualView({ start: clamp(v.start, 0, d - dur), dur });
  };
  const scale = () => width() / view().dur;
  const x = (t: number) => (t - view().start) * scale();
  const timeAt = (px: number) => view().start + px / scale();

  const ctx: Ctx = {
    store,
    player,
    audioSource: audio,
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
      const dur = clamp(v.dur * factor, MIN_VIEW_DUR, duration());
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
    void navigator.clipboard?.write?.([new ClipboardItem(items)]).catch(() => { });
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
