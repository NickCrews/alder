import { Show, createEffect, onMount } from "solid-js";
import type { Ctx } from "./ctx";
import { startDrag } from "../drag";
import { clamp } from "../time";

const HEIGHT = 96;

export function Waveform(props: { ctx: Ctx }) {
  const source = props.ctx.audioSource;
  /** The load error, if the source ended up with one. */
  const failure = () => {
    const s = source.geometry();
    return s.state === "failed" ? s.error : null;
  };
  let canvas: HTMLCanvasElement | undefined;

  function draw() {
    const w = props.ctx.width();
    const { start, dur } = props.ctx.view();
    // Subscribe: a streaming source redraws as finer data lands.
    source.version();
    if (!canvas || w <= 0) return;
    const cols = Math.max(1, Math.round(w));
    source.prefetch(start, start + dur);
    const { mins, maxs } = source.peaks(start, start + dur, cols);
    let g: CanvasRenderingContext2D | null = null;
    try {
      g = canvas.getContext("2d");
    } catch {
      return; // e.g. jsdom
    }
    if (!g) return;
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, HEIGHT);
    g.strokeStyle = "rgba(148, 163, 184, 0.25)";
    g.beginPath();
    g.moveTo(0, HEIGHT / 2);
    g.lineTo(w, HEIGHT / 2);
    g.stroke();
    g.fillStyle = "#38bdf8";
    const mid = HEIGHT / 2;
    const amp = HEIGHT / 2 - 2;
    for (let col = 0; col < cols; col++) {
      const lo = mins[col];
      const hi = maxs[col];
      if (lo === 0 && hi === 0) continue;
      const y0 = mid - clamp(hi, -1, 1) * amp;
      const y1 = mid - clamp(lo, -1, 1) * amp;
      g.fillRect(col, y0, 1, Math.max(y1 - y0, 1));
    }
  }

  onMount(draw);
  createEffect(draw);

  /** Click seeks; horizontal drag pans. */
  function onPointerDown(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const view0 = props.ctx.view();
    startDrag(e, {
      onMove: (dx) => {
        props.ctx.setView({ start: view0.start - dx / props.ctx.scale(), dur: view0.dur });
      },
      onEnd: (moved) => {
        if (!moved) props.ctx.player.seek(props.ctx.timeAt(px));
      },
    });
  }

  return (
    <div
      class="relative w-full cursor-crosshair overflow-hidden rounded bg-zinc-950"
      style={{ height: `${HEIGHT}px` }}
      onPointerDown={onPointerDown}
    >
      <canvas ref={canvas} class="absolute inset-0 h-full w-full" />
      <Show when={source.geometry().state !== "known"}>
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs">
          <Show when={failure()} fallback={<span class="text-zinc-500">Loading audio…</span>}>
            {(err) => <span class="text-red-400">Audio failed to load: {err().message}</span>}
          </Show>
        </div>
      </Show>
    </div>
  );
}
