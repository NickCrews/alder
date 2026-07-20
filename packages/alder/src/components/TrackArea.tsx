import { For, Index, Show, createMemo } from "solid-js";
import type { Ctx } from "./ctx";
import type { SegRec } from "../store";
import { assignLanes } from "../lanes";
import { segEnd, segStart } from "../time";
import { speakerColor } from "../colors";
import { startDrag } from "../drag";
import { WordChip } from "./WordChip";

export const LANE_HEIGHT = 60;
const LABEL_HEIGHT = 16;

function SegmentBlock(props: { ctx: Ctx; seg: SegRec; lane: number }) {
  const { store } = props.ctx;
  const start = () => segStart(props.seg);
  const end = () => segEnd(props.seg);
  const left = () => props.ctx.x(start());
  const width = () => Math.max(props.ctx.x(end()) - left(), 10);
  const color = () => speakerColor(store.doc.speakers, props.seg.speaker_id);
  const selected = () => store.selection()?.segKey === props.seg.key;
  const visible = () => {
    const v = props.ctx.view();
    return end() >= v.start && start() <= v.start + v.dur;
  };

  function onPointerDown(e: PointerEvent) {
    e.stopPropagation();
    let applied = 0;
    startDrag(e, {
      onStart: () => {
        store.beginOp();
        store.setSelection({ segKey: props.seg.key, wordIdx: null });
      },
      onMove: (dx) => {
        const total = dx / props.ctx.scale();
        store.moveSegment(props.seg.key, total - applied);
        applied = total;
      },
      onEnd: (moved) => {
        if (moved) store.endOp();
        else store.setSelection({ segKey: props.seg.key, wordIdx: null });
      },
    });
  }

  return (
    <Show when={visible()}>
      <div
        class="absolute overflow-hidden rounded border"
        classList={{ "z-10": selected() }}
        style={{
          left: `${left()}px`,
          width: `${width()}px`,
          top: `${props.lane * LANE_HEIGHT + 4}px`,
          height: `${LANE_HEIGHT - 8}px`,
          "background-color": color() + "1e",
          "border-color": selected() ? color() : color() + "55",
          "box-shadow": selected() ? `0 0 0 1px ${color()}` : "none",
        }}
      >
        <div
          class="flex cursor-grab touch-none items-center px-1 select-none active:cursor-grabbing"
          style={{ height: `${LABEL_HEIGHT}px` }}
          onPointerDown={onPointerDown}
          title="Drag to move segment in time; click to select"
        >
          <span class="relative inline-flex max-w-full items-center">
            <select
              class="max-w-full cursor-pointer appearance-none truncate rounded border pl-1 pr-3.5 text-[10px] leading-[13px] font-medium outline-none hover:brightness-125"
              style={{
                color: color(),
                "border-color": color() + "66",
                "background-color": color() + "22",
              }}
              value={props.seg.speaker_id}
              title="Change speaker"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                store.setSegmentSpeaker(props.seg.key, Number(e.currentTarget.value))
              }
            >
              <For each={store.doc.speakers}>
                {(sp) => (
                  <option class="bg-zinc-900 text-zinc-100" value={sp.id}>
                    {sp.label}
                  </option>
                )}
              </For>
            </select>
            <svg
              class="pointer-events-none absolute right-1 h-2 w-2"
              style={{ color: color() }}
              viewBox="0 0 8 8"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M1.5 3l2.5 2.5L6.5 3" />
            </svg>
          </span>
        </div>
        <div class="relative" style={{ height: `${LANE_HEIGHT - 8 - LABEL_HEIGHT}px` }}>
          <Index each={props.seg.words}>
            {(_, i) => (
              <WordChip
                ctx={props.ctx}
                seg={props.seg}
                index={i}
                blockLeft={left()}
                color={color()}
              />
            )}
          </Index>
        </div>
      </div>
    </Show>
  );
}

export function TrackArea(props: { ctx: Ctx }) {
  const { store } = props.ctx;
  const lanes = createMemo(() => assignLanes(store.doc.segments));
  const height = () => lanes().count * LANE_HEIGHT + 24;

  function onDblClick(e: MouseEvent) {
    if (e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = props.ctx.timeAt(e.clientX - rect.left);
    const sel = store.selection();
    const speakerId = sel ? store.getSeg(sel.segKey)?.speaker_id : undefined;
    store.createSegment(t, speakerId);
  }

  return (
    <div
      class="relative w-full overflow-hidden rounded bg-zinc-950/60"
      style={{ height: `${height()}px` }}
      onDblClick={onDblClick}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) store.setSelection(null);
      }}
      title="Double-click empty space to add a segment"
    >
      <For each={store.doc.segments}>
        {(seg) => (
          <SegmentBlock ctx={props.ctx} seg={seg} lane={lanes().lane.get(seg.key) ?? 0} />
        )}
      </For>
    </div>
  );
}
