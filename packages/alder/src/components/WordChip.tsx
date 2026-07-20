import { Show, createEffect, createSignal } from "solid-js";
import type { Ctx } from "./ctx";
import type { SegRec } from "../store";
import { startDrag } from "../drag";
import { wordEnd } from "../time";

type EditMode =
  | { mode: "all" } // double-click: select the existing text
  | { mode: "end" } // Enter: caret after the existing text
  | { mode: "replace"; seed: string }; // typed: replace text with the seed

export function WordChip(props: {
  ctx: Ctx;
  seg: SegRec;
  index: number;
  /** px offset of the segment block's left edge */
  blockLeft: number;
  color: string;
}) {
  const { store } = props.ctx;
  const [editing, setEditing] = createSignal<EditMode | null>(null);
  let inputEl: HTMLInputElement | undefined;

  const word = () => props.seg.words[props.index];
  const left = () => props.ctx.x(word().timestamp) - props.blockLeft;
  const width = () =>
    Math.max(
      props.ctx.x(wordEnd(props.seg.words, props.index)) - props.ctx.x(word().timestamp) - 2,
      6,
    );
  const selected = () => {
    const sel = store.selection();
    return sel?.segKey === props.seg.key && sel.wordIdx === props.index;
  };

  createEffect(() => {
    const req = store.editRequest();
    if (!req || req.segKey !== props.seg.key || req.wordIdx !== props.index) return;
    store.setEditRequest(null);
    setEditing(req.seed != null ? { mode: "replace", seed: req.seed } : { mode: "end" });
  });

  function onPointerDown(e: PointerEvent) {
    if (editing()) return;
    e.stopPropagation();
    const t0 = word().timestamp;
    startDrag(e, {
      onStart: () => {
        store.beginOp();
        store.setSelection({ segKey: props.seg.key, wordIdx: props.index });
      },
      onMove: (dx) => store.moveWord(props.seg.key, props.index, t0 + dx / props.ctx.scale()),
      onEnd: (moved) => {
        if (moved) store.endOp();
        else store.setSelection({ segKey: props.seg.key, wordIdx: props.index });
      },
    });
  }

  function commit(value: string) {
    setEditing(null);
    store.commitWordText(props.seg.key, props.index, value);
  }

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === "Enter") {
      commit(el.value);
    } else if (e.key === "Escape") {
      setEditing(null);
    } else if (
      e.key === "Backspace" &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0 &&
      props.index > 0
    ) {
      e.preventDefault();
      setEditing(null);
      store.joinWithPrev(props.seg.key, props.index, el.value);
    }
  }

  return (
    <div
      class="absolute top-0.5 h-6 cursor-grab touch-none rounded-sm border text-xs leading-6 text-zinc-100 active:cursor-grabbing"
      classList={{ "ring-1 ring-white z-10": selected() }}
      style={{
        left: `${left()}px`,
        width: editing() ? "auto" : `${width()}px`,
        "background-color": props.color + "55",
        "border-color": props.color + "88",
      }}
      title={`${word().text} @ ${word().timestamp.toFixed(2)}s`}
      onPointerDown={onPointerDown}
      onDblClick={(e) => {
        e.stopPropagation();
        setEditing({ mode: "all" });
      }}
    >
      <Show
        when={editing()}
        fallback={<span class="block truncate px-1 select-none">{word().text}</span>}
      >
        <input
          ref={(el) => {
            inputEl = el;
            queueMicrotask(() => {
              el.focus();
              const ed = editing();
              if (ed?.mode === "replace") {
                el.value = ed.seed;
                el.setSelectionRange(ed.seed.length, ed.seed.length);
              } else if (ed?.mode === "end") {
                el.setSelectionRange(el.value.length, el.value.length);
              } else {
                el.select();
              }
            });
          }}
          class="h-full min-w-16 rounded-sm bg-zinc-800 px-1 text-xs text-white outline-none"
          value={word().text}
          onKeyDown={onKeyDown}
          onBlur={() => editing() && inputEl && commit(inputEl.value)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </Show>
    </div>
  );
}
