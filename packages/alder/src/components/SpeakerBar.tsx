import { For, Show, createSignal } from "solid-js";
import type { Ctx } from "./ctx";
import type { Speaker } from "../types";
import { speakerColor } from "../colors";

function SpeakerChip(props: { ctx: Ctx; speaker: Speaker }) {
  const { store } = props.ctx;
  const [editing, setEditing] = createSignal(false);
  const color = () => speakerColor(store.doc.speakers, props.speaker.id);
  const inUse = () => store.speakerInUse(props.speaker.id);

  return (
    <div
      class="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 py-0.5 pr-1 pl-2 text-xs"
      style={{ "border-color": color() + "66" }}
    >
      <span
        class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ "background-color": color() }}
      />
      <Show
        when={editing()}
        fallback={
          <span
            class="cursor-text select-none"
            title="Double-click to rename"
            onDblClick={() => setEditing(true)}
          >
            {props.speaker.label}
          </span>
        }
      >
        <input
          ref={(el) =>
            queueMicrotask(() => {
              el.focus();
              el.select();
            })
          }
          class="w-24 rounded bg-zinc-900 px-1 outline-none"
          value={props.speaker.label}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              store.renameSpeaker(props.speaker.id, e.currentTarget.value);
              setEditing(false);
            } else if (e.key === "Escape") setEditing(false);
          }}
          onBlur={(e) => {
            if (editing()) store.renameSpeaker(props.speaker.id, e.currentTarget.value);
            setEditing(false);
          }}
        />
      </Show>
      <button
        class="rounded-full px-1 text-zinc-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
        disabled={inUse()}
        title={inUse() ? "Speaker has segments; reassign them first" : "Delete speaker"}
        onClick={() => store.deleteSpeaker(props.speaker.id)}
      >
        ×
      </button>
    </div>
  );
}

export function SpeakerBar(props: { ctx: Ctx }) {
  const { store } = props.ctx;
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-[10px] tracking-wide text-zinc-500 uppercase">Speakers</span>
      <For each={store.doc.speakers}>
        {(sp) => <SpeakerChip ctx={props.ctx} speaker={sp} />}
      </For>
      <button
        class="rounded-full border border-dashed border-zinc-600 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-400 hover:text-zinc-200"
        onClick={() => store.addSpeaker()}
      >
        + speaker
      </button>
    </div>
  );
}
