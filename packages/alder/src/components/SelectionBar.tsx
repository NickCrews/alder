import { Show } from "solid-js";
import type { Ctx } from "./ctx";

const btn =
  "rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";

export function SelectionBar(props: { ctx: Ctx }) {
  const { store } = props.ctx;
  const sel = () => store.selection();
  const seg = () => {
    const s = sel();
    return s ? store.getSeg(s.segKey) : undefined;
  };
  const multi = () => store.selectedSegKeys().length > 1;

  return (
    <div class="flex min-h-7 flex-wrap items-center gap-2 text-xs text-zinc-400">
      <Show
        when={!multi()}
        fallback={
          <span class="text-zinc-500">
            ⇧-click extends the range · ⌥-click toggles a segment · ⌫ deletes the selected
            segments
          </span>
        }
      >
        <Show
          when={seg()}
          fallback={
            <span class="text-zinc-500">
              Click to select · ⇧/⌥-click to select several segments · double-click a word to
              edit text (space splits, ⌫ at start joins) · double-click empty track space to
              add a segment · drag words/segments to retime · scroll to zoom, drag waveform to
              pan
            </span>
          }
        >
          {(s) => (
            <>
              <span class="font-medium text-zinc-300">
                {sel()!.wordIdx != null ? "Word" : "Segment"}
              </span>
              <Show when={sel()!.wordIdx != null}>
                <button
                  class={btn}
                  disabled={sel()!.wordIdx === 0}
                  title="Split this segment before the selected word"
                  onClick={() => store.splitSegment(s().key, sel()!.wordIdx!)}
                >
                  Split before word
                </button>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
