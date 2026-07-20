import { createEffect, onMount } from "solid-js";
import type { Ctx } from "./ctx";
import { startDrag } from "../drag";
import { clamp } from "../time";

const HEIGHT = 96;
const BLOCK = 128;

interface Mipmap {
  mins: Float32Array;
  maxs: Float32Array;
}

function buildMipmap(audio: Float32Array): Mipmap {
  const n = Math.ceil(audio.length / BLOCK);
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = Infinity;
    let hi = -Infinity;
    const end = Math.min((b + 1) * BLOCK, audio.length);
    for (let i = b * BLOCK; i < end; i++) {
      const v = audio[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    mins[b] = lo === Infinity ? 0 : lo;
    maxs[b] = hi === -Infinity ? 0 : hi;
  }
  return { mins, maxs };
}

export function Waveform(props: { ctx: Ctx }) {
  const { store } = props.ctx;
  const audio = store.audio;
  const sr = store.sampleRate;
  const mip = buildMipmap(audio);
  let canvas: HTMLCanvasElement | undefined;

  function draw() {
    const w = props.ctx.width();
    const { start, dur } = props.ctx.view();
    if (!canvas || w <= 0) return;
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
    for (let col = 0; col < w; col++) {
      const s0 = Math.max(0, Math.floor((start + (col / w) * dur) * sr));
      const s1 = Math.min(audio.length, Math.ceil((start + ((col + 1) / w) * dur) * sr));
      if (s1 <= s0) continue;
      let lo = Infinity;
      let hi = -Infinity;
      if (s1 - s0 > BLOCK * 2) {
        const b0 = Math.floor(s0 / BLOCK);
        const b1 = Math.min(mip.mins.length, Math.ceil(s1 / BLOCK));
        for (let b = b0; b < b1; b++) {
          if (mip.mins[b] < lo) lo = mip.mins[b];
          if (mip.maxs[b] > hi) hi = mip.maxs[b];
        }
      } else {
        for (let i = s0; i < s1; i++) {
          const v = audio[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (lo === Infinity) continue;
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
    </div>
  );
}
