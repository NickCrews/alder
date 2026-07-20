import { Match, Switch } from "solid-js";
import type { Ctx } from "./ctx";

/** Context-sensitive hint line under the track area. */
export function SelectionBar(props: { ctx: Ctx }) {
  const { store } = props.ctx;
  const sel = () => store.selection();
  const count = () => store.selectedItems().length;

  return (
    <div class="flex min-h-7 flex-wrap items-center gap-2 text-xs text-zinc-500">
      <Switch
        fallback={
          <span>
            Click to select · ⇧-click or ⇧←/→ for a range, ⌥-click to toggle (words and
            segments can be mixed) · right-click a segment to split it · double-click a word
            to edit text (space splits, ⌫ at start joins) · double-click empty track space to
            add a segment · drag words/segments to retime · scroll to zoom, drag waveform to
            pan
          </span>
        }
      >
        <Match when={count() > 1}>
          <span>
            <span class="font-medium text-zinc-300">{count()} selected</span> · ⇧-click or
            ⇧←/→ adjusts the range · ⌥-click toggles one · ⌫ deletes them all
          </span>
        </Match>
        <Match when={sel()?.wordIdx != null}>
          <span>
            <span class="font-medium text-zinc-300">Word</span> · Enter or double-click to
            edit · ←/→ moves, ⇧←/→ selects several · ⌫ deletes
          </span>
        </Match>
        <Match when={sel()}>
          <span>
            <span class="font-medium text-zinc-300">Segment</span> · right-click to split ·
            ⇧/⌥-click to select several · ⌫ deletes
          </span>
        </Match>
      </Switch>
    </div>
  );
}
