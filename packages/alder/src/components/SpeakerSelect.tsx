import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import type { Ctx } from "./ctx";
import { speakerColor } from "../colors";

/** Pill-shaped speaker picker rendered inside a segment block. The menu is
 * portaled to the body so it isn't clipped by the segment's overflow-hidden. */
export function SpeakerSelect(props: { ctx: Ctx; segKey: number; speakerId: number }) {
  const { store } = props.ctx;
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number } | null>(null);
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

  createEffect(() => {
    if (!menuPos()) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuPos(null);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  return (
    <>
      <button
        ref={btnRef}
        class="inline-flex max-w-full cursor-pointer items-center gap-1 rounded border px-1 text-[10px] leading-[13px] font-medium hover:brightness-125 focus:outline-none"
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
          <Portal>
            <div
              class="fixed inset-0 z-40"
              onPointerDown={(e) => {
                e.stopPropagation();
                setMenuPos(null);
              }}
            />
            <div
              class="alder-root fixed z-50 min-w-32 rounded-md border border-zinc-700 bg-zinc-800 py-1 font-sans text-xs text-zinc-100 shadow-xl shadow-black/40"
              style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
            >
              <For each={store.doc.speakers}>
                {(sp) => {
                  const c = () => speakerColor(store.doc.speakers, sp.id);
                  const current = () => sp.id === props.speakerId;
                  return (
                    <button
                      class="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-zinc-700"
                      onClick={() => pick(sp.id)}
                    >
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
                    </button>
                  );
                }}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
