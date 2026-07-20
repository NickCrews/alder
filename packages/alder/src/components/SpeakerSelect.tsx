import { For, Show, createSignal } from "solid-js";
import type { Ctx } from "./ctx";
import { speakerColor } from "../colors";
import { ContextMenu, MenuItem, type MenuPos } from "./ContextMenu";

/** Pill-shaped speaker picker rendered inside a segment block. The menu is
 * portaled to the body so it isn't clipped by the segment's overflow-hidden. */
export function SpeakerSelect(props: { ctx: Ctx; segKey: number; speakerId: number }) {
  const { store } = props.ctx;
  const [menuPos, setMenuPos] = createSignal<MenuPos | null>(null);
  let btnRef: HTMLButtonElement | undefined;

  const color = () => speakerColor(store.doc.speakers, props.speakerId);
  const label = () =>
    store.doc.speakers.find((s) => s.id === props.speakerId)?.label ??
    `#${props.speakerId}`;

  function toggle() {
    if (menuPos()) {
      setMenuPos(null);
      return;
    }
    const r = btnRef!.getBoundingClientRect();
    setMenuPos({
      x: Math.min(r.left, Math.max(0, window.innerWidth - 160)),
      y: r.bottom + 2,
    });
  }

  function pick(speakerId: number) {
    store.setSegmentSpeaker(props.segKey, speakerId);
    setMenuPos(null);
  }

  return (
    <>
      <button
        ref={btnRef}
        class="inline-flex max-w-full cursor-pointer items-center gap-1 rounded border px-1.5 text-[11px] leading-4 font-medium hover:brightness-125 focus:outline-none"
        style={{
          color: color(),
          "border-color": color() + "66",
          "background-color": color() + "22",
        }}
        title="Change speaker"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={toggle}
      >
        <span
          class="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ "background-color": color() }}
        />
        <span class="truncate">{label()}</span>
        <svg
          class="h-2 w-2 shrink-0"
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M1.5 3l2.5 2.5L6.5 3" />
        </svg>
      </button>
      <Show when={menuPos()}>
        {(pos) => (
          <ContextMenu pos={pos()} onClose={() => setMenuPos(null)}>
            <For each={store.doc.speakers}>
              {(sp) => {
                const c = () => speakerColor(store.doc.speakers, sp.id);
                const current = () => sp.id === props.speakerId;
                return (
                  <MenuItem onSelect={() => pick(sp.id)}>
                    <span
                      class="h-2 w-2 shrink-0 rounded-full"
                      style={{ "background-color": c() }}
                    />
                    <span class="truncate" style={{ color: current() ? c() : undefined }}>
                      {sp.label}
                    </span>
                    <Show when={current()}>
                      <span class="ml-auto pl-2 text-zinc-400">✓</span>
                    </Show>
                  </MenuItem>
                );
              }}
            </For>
          </ContextMenu>
        )}
      </Show>
    </>
  );
}
