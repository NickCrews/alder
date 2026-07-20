import { For, Show } from "solid-js";
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

  return (
    <div class="flex min-h-7 flex-wrap items-center gap-2 text-xs text-zinc-400">
      <Show
        when={seg()}
        fallback={
          <span class="text-zinc-500">
            Click to select · double-click a word to edit text (space splits, ⌫ at start
            joins) · double-click empty track space to add a segment · drag words/segments to
            retime · scroll to zoom, drag waveform to pan
          </span>
        }
      >
        {(s) => (
          <>
            <span class="font-medium text-zinc-300">
              {sel()!.wordIdx != null ? "Word" : "Segment"}
            </span>
            <label class="flex items-center gap-1">
              speaker
              <select
                class="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-xs"
                value={s().speaker_id}
                onChange={(e) =>
                  store.setSegmentSpeaker(s().key, Number(e.currentTarget.value))
                }
              >
                <For each={store.doc.speakers}>
                  {(sp) => <option value={sp.id}>{sp.label}</option>}
                </For>
              </select>
            </label>
            <Show when={sel()!.wordIdx != null}>
              <button
                class={btn}
                disabled={sel()!.wordIdx === 0}
                title="Split this segment before the selected word"
                onClick={() => store.splitSegment(s().key, sel()!.wordIdx!)}
              >
                Split before word
              </button>
              <button class={btn} onClick={() => store.deleteWord(s().key, sel()!.wordIdx!)}>
                Delete word
              </button>
            </Show>
            <button
              class={btn}
              title="Merge with the next segment of the same speaker"
              onClick={() => store.mergeWithNext(s().key)}
            >
              Merge next
            </button>
            <button class={btn} onClick={() => store.deleteSegment(s().key)}>
              Delete segment
            </button>
          </>
        )}
      </Show>
    </div>
  );
}
