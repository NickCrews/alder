import type { Ctx } from "./ctx";
import { formatTime } from "../time";

const btn =
  "rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";

export function Toolbar(props: { ctx: Ctx }) {
  const { player, store } = props.ctx;

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
        {formatTime(player.time())} / {formatTime(player.duration)}
      </span>
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
        onClick={() => props.ctx.setView({ start: 0, dur: props.ctx.duration })}
        title="Fit whole clip"
      >
        fit
      </button>
    </div>
  );
}
