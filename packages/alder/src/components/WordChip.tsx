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
  const [hovered, setHovered] = createSignal(false);
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
  // Shrink the label (down to a floor) when the chip is too narrow for it at
  // the default 12px. 0.58 approximates average glyph width per px of font-size.
  const fontSize = () => {
    const chars = word().text.length || 1;
    const avail = width() - 8; // minus px-1 padding on both sides
    return Math.max(8, Math.min(12, avail / (chars * 0.58)));
  };
  // Selected chips expand inline: anchored at the word's timestamp, growing
  // rightward over neighbors so the word reads at full size while you work on it.
  const expanded = () => !editing() && selected();
  // Hovered chips instead float a full-size label above the row, where the
  // mouse cursor can't cover it (the chip stays put as the hover target).
  // Skipped for words already readable at full size, and for the selected word
  // (its inline expansion already shows the text).
  const hoverLabel = () => !editing() && hovered() && !selected() && fontSize() < 12;

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
      class="absolute inset-y-0.5 flex cursor-grab touch-none items-center rounded-sm border text-xs text-zinc-100 active:cursor-grabbing"
      classList={{
        "ring-1 ring-white": selected(),
        "z-10": expanded() || hoverLabel(),
        "shadow-md shadow-black/50": expanded(),
      }}
      style={{
        left: `${left()}px`,
        width: editing() ? "auto" : expanded() ? "max-content" : `${width()}px`,
        "min-width": expanded() ? `${width()}px` : undefined,
        "background-color": expanded()
          ? `color-mix(in srgb, ${props.color} 35%, #18181b)`
          : props.color + "55",
        "border-color": props.color + "88",
      }}
      title={`${word().text} @ ${word().timestamp.toFixed(2)}s`}
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDblClick={(e) => {
        e.stopPropagation();
        setEditing({ mode: "all" });
      }}
    >
      <Show when={hoverLabel()}>
        <div
          class="pointer-events-none absolute bottom-full left-0 mb-1 w-max rounded-sm border px-1 shadow-md shadow-black/50"
          style={{
            "background-color": `color-mix(in srgb, ${props.color} 35%, #18181b)`,
            "border-color": props.color + "88",
          }}
        >
          {word().text}
        </div>
      </Show>
      <Show
        when={editing()}
        fallback={
          <span
            class="w-full truncate px-1 select-none"
            style={{ "font-size": expanded() ? undefined : `${fontSize()}px` }}
          >
            {word().text}
          </span>
        }
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
