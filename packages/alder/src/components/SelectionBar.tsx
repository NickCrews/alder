import { Show } from "solid-js";
import type { Ctx } from "./ctx";

/** Context-sensitive hint line under the track area. */
export function SelectionBar(props: { ctx: Ctx }) {
  const { store } = props.ctx;
  const sel = () => store.selection();
  const multi = () => store.selectedSegKeys().length > 1;

  return (
    <div class="flex min-h-7 flex-wrap items-center gap-2 text-xs text-zinc-500">
      <Show
        when={!multi()}
        fallback={
          <span>
            ⇧-click extends the range · ⌥-click toggles a segment · ⌫ deletes the selected
            segments
          </span>
        }
      >
        <Show
          when={sel()}
          fallback={
            <span>
              Click to select · ⇧/⌥-click to select several segments · right-click a segment
              to split it · double-click a word to edit text (space splits, ⌫ at start
              joins) · double-click empty track space to add a segment · drag words/segments
              to retime · scroll to zoom, drag waveform to pan
            </span>
          }
        >
          <Show
            when={sel()!.wordIdx != null}
            fallback={
              <span>
                <span class="font-medium text-zinc-300">Segment</span> · right-click to
                split · ⌫ deletes
              </span>
            }
          >
            <span>
              <span class="font-medium text-zinc-300">Word</span> · Enter or double-click to
              edit · ⌫ deletes
            </span>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
