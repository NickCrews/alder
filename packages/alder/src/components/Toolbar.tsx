import { For, Show } from "solid-js";
import type { Ctx } from "./ctx";
import { formatTime } from "../time";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const btn =
  "rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";

export function Toolbar(props: { ctx: Ctx }) {
  const { player, store } = props.ctx;

  /** Clip length for the clock — a dash while the audio hasn't said yet. */
  const total = () => {
    const d = player.duration();
    return d == null ? "—" : formatTime(d);
  };

  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  /** "3 segments", "5 words", or "2 segments + 5 words" for a mixed selection. */
  const selectionLabel = () => {
    const segs = store.selectedSegKeys().length;
    const words = store.selectedWords().length;
    if (!segs) return plural(words, "word");
    if (!words) return plural(segs, "segment");
    return `${plural(segs, "segment")} + ${plural(words, "word")}`;
  };

  function zoom(factor: number) {
    const v = props.ctx.view();
    const center = v.start + v.dur / 2;
    const dur = v.dur * factor;
    props.ctx.setView({ start: center - dur / 2, dur });
  }

  return (
    <div class="flex flex-wrap items-center gap-2">
      <button
        class={`${btn} w-9 font-mono`}
        onClick={() => player.toggle()}
        title="Play/pause (space)"
      >
        {player.playing() ? "❚❚" : "▶"}
      </button>
      <span class="font-mono text-xs text-zinc-400">
        {formatTime(player.time())} / {total()}
      </span>
      <select
        class={`${btn} font-mono`}
        value={String(player.rate())}
        onChange={(e) => player.setRate(Number(e.currentTarget.value))}
        title="Playback speed"
      >
        <For each={SPEEDS}>{(s) => <option value={String(s)}>{s}×</option>}</For>
      </select>
      <Show when={store.selectedItems().length > 1}>
        <span class="mx-1 h-4 w-px bg-zinc-700" />
        <span class="text-xs text-zinc-400">{selectionLabel()} selected</span>
        <Show when={store.selectedSegKeys().length > 1}>
          <button
            class="rounded border border-sky-700 bg-sky-900/60 px-2 py-0.5 text-xs text-sky-200 hover:bg-sky-800/60"
            title="Merge the selected segments into one (earliest segment's speaker wins)"
            onClick={() => store.mergeSegments(store.selectedSegKeys())}
          >
            Merge {store.selectedSegKeys().length}
          </button>
        </Show>
      </Show>
      <span class="flex-1" />
      <button class={btn} disabled={!store.canUndo()} onClick={() => store.undo()} title="Undo (⌘Z)">
        ↺ undo
      </button>
      <button class={btn} disabled={!store.canRedo()} onClick={() => store.redo()} title="Redo (⇧⌘Z)">
        ↻ redo
      </button>
      <span class="mx-1 h-4 w-px bg-zinc-700" />
      <button class={btn} onClick={() => zoom(1.5)} title="Zoom out">
        −
      </button>
      <button class={btn} onClick={() => zoom(1 / 1.5)} title="Zoom in">
        +
      </button>
      <button
        class={btn}
        onClick={() => props.ctx.setView({ start: 0, dur: props.ctx.duration() })}
        title="Fit whole clip"
      >
        fit
      </button>
    </div>
  );
}
