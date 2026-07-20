import { For, Index, Show, createMemo, createSignal } from "solid-js";
import type { Ctx } from "./ctx";
import type { SegRec } from "../store";
import { assignLanes } from "../lanes";
import { segEnd, segStart } from "../time";
import { speakerColor } from "../colors";
import { startDrag } from "../drag";
import { WordChip } from "./WordChip";
import { SpeakerSelect } from "./SpeakerSelect";
import { ContextMenu, MenuItem, type MenuPos, menuPosAt } from "./ContextMenu";

export const LANE_HEIGHT = 72;
const LABEL_HEIGHT = 20;
/** Vertical gap between a segment block and its lane edges. */
const LANE_PAD = 4;
/** Empty strip below the last lane — the right-click-to-add target when lanes are full. */
const TRACK_PAD = 20;

function SegmentBlock(props: { ctx: Ctx; seg: SegRec; lane: number }) {
  const { store } = props.ctx;
  const start = () => segStart(props.seg);
  const end = () => segEnd(props.seg, props.ctx.store.lastWordDur());
  const left = () => props.ctx.x(start());
  const width = () => Math.max(props.ctx.x(end()) - left(), 10);
  const color = () => speakerColor(store.doc.speakers, props.seg.speaker_id);
  /** The whole segment is selected — ⌫ takes it and its words with it. */
  const selected = () => store.isSegSelected(props.seg.key);
  /** …or it merely holds a selected word, which only earns it a raise. */
  const active = () => store.segHasSelection(props.seg.key);
  const visible = () => {
    const v = props.ctx.view();
    return end() >= v.start && start() <= v.start + v.dur;
  };

  const [menu, setMenu] = createSignal<(MenuPos & { splitIdx: number | null }) | null>(null);

  /** Right-click anywhere on the segment: offer to split at the clicked time. */
  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!store.segHasSelection(props.seg.key)) {
      store.setSelection({ segKey: props.seg.key, wordIdx: null });
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = start() + (e.clientX - rect.left) / props.ctx.scale();
    const i = props.seg.words.findIndex((w) => w.timestamp > t);
    setMenu({ ...menuPosAt(e), splitIdx: i >= 1 ? i : null });
  }

  function onPointerDown(e: PointerEvent) {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) {
      const item = { segKey: props.seg.key, wordIdx: null };
      if (e.shiftKey) store.selectRangeTo(item);
      else store.toggleSelected(item);
      return;
    }
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
        class="absolute rounded border hover:z-20"
        classList={{ "z-10": active() }}
        onContextMenu={onContextMenu}
        style={{
          left: `${left()}px`,
          width: `${width()}px`,
          top: `${props.lane * LANE_HEIGHT + LANE_PAD}px`,
          height: `${LANE_HEIGHT - LANE_PAD * 2}px`,
          "background-color": color() + "1e",
          "border-color": selected() ? color() : color() + "55",
          "box-shadow": selected() ? `0 0 0 1px ${color()}` : "none",
        }}
      >
        <div
          class="flex cursor-grab touch-none items-center gap-1 px-1.5 select-none active:cursor-grabbing"
          style={{ height: `${LABEL_HEIGHT}px` }}
          onPointerDown={onPointerDown}
          title="Drag to move segment in time; click to select; ⇧-click to select a range, ⌥-click to toggle"
        >
          <SpeakerSelect
            ctx={props.ctx}
            segKey={props.seg.key}
            speakerId={props.seg.speaker_id}
          />
          <button
            class="ml-auto shrink-0 cursor-pointer rounded p-0.5 text-zinc-500 hover:bg-zinc-700/60 hover:text-red-400"
            title="Delete segment"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => store.deleteSegment(props.seg.key)}
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            >
              <path d="M1.5 3h9M4.5 3V1.5h3V3M2.5 3l.5 7.5h6l.5-7.5M4.75 5v3.5M7.25 5v3.5" />
            </svg>
          </button>
        </div>
        <div
          class="relative"
          style={{ height: `${LANE_HEIGHT - LANE_PAD * 2 - LABEL_HEIGHT}px` }}
        >
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
      <Show when={menu()}>
        {(m) => (
          <ContextMenu pos={m()} onClose={() => setMenu(null)}>
            <MenuItem
              disabled={m().splitIdx == null}
              title={
                m().splitIdx == null
                  ? "Nothing to split off here — click between two words"
                  : "Split the segment at this point"
              }
              onSelect={() => {
                const i = m().splitIdx;
                setMenu(null);
                if (i != null) store.splitSegment(props.seg.key, i);
              }}
            >
              Split here
            </MenuItem>
          </ContextMenu>
        )}
      </Show>
    </Show>
  );
}

export function TrackArea(props: { ctx: Ctx }) {
  const { store } = props.ctx;
  const lanes = createMemo(() => assignLanes(store.doc.segments, store.lastWordDur()));
  const height = () => lanes().count * LANE_HEIGHT + TRACK_PAD;

  const [menu, setMenu] = createSignal<(MenuPos & { time: number }) | null>(null);

  /** Right-click empty track space: offer to start a segment at that time. */
  function onContextMenu(e: MouseEvent) {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ ...menuPosAt(e), time: props.ctx.timeAt(e.clientX - rect.left) });
  }

  function addSegment(t: number) {
    setMenu(null);
    const sel = store.selection();
    const speakerId = sel ? store.getSeg(sel.segKey)?.speaker_id : undefined;
    store.createSegment(t, speakerId);
  }

  return (
    <div
      class="relative w-full overflow-hidden rounded bg-zinc-950/60"
      style={{ height: `${height()}px` }}
      onContextMenu={onContextMenu}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) store.setSelection(null);
      }}
      title="Right-click empty space to add a segment"
    >
      <For each={store.doc.segments}>
        {(seg) => (
          <SegmentBlock ctx={props.ctx} seg={seg} lane={lanes().lane.get(seg.key) ?? 0} />
        )}
      </For>
      <Show when={menu()}>
        {(m) => (
          <ContextMenu pos={m()} onClose={() => setMenu(null)}>
            <MenuItem
              title="Start a new segment at this point"
              onSelect={() => addSegment(m().time)}
            >
              Add segment here
            </MenuItem>
          </ContextMenu>
        )}
      </Show>
    </div>
  );
}
