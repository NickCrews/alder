import { createSignal } from "solid-js";
import { clamp } from "./time";

/** Web Audio playback for a Float32Array. No-ops in environments without
 * AudioContext (e.g. jsdom). */
export function createPlayer(audio: Float32Array, sampleRate: number) {
  const duration = audio.length / sampleRate;
  const [playing, setPlaying] = createSignal(false);
  const [time, setTime] = createSignal(0);
  const [rate, setRateSignal] = createSignal(1);

  let ctx: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let src: AudioBufferSourceNode | null = null;
  let startedAtCtxTime = 0;
  let startOffset = 0;
  let raf = 0;

  const supported = typeof AudioContext !== "undefined";

  function ensure(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      buffer = ctx.createBuffer(1, Math.max(audio.length, 1), sampleRate);
      buffer.getChannelData(0).set(audio);
    }
    return ctx;
  }

  function currentTime(): number {
    if (playing() && ctx)
      return clamp(startOffset + (ctx.currentTime - startedAtCtxTime) * rate(), 0, duration);
    return time();
  }

  function tick() {
    setTime(currentTime());
    if (playing()) raf = requestAnimationFrame(tick);
  }

  function stopSource() {
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* not started */
      }
      src.disconnect();
      src = null;
    }
    cancelAnimationFrame(raf);
  }

  function play() {
    if (!supported || playing() || !audio.length) return;
    const c = ensure();
    void c.resume();
    const from = time() >= duration - 0.01 ? 0 : time();
    src = c.createBufferSource();
    src.buffer = buffer!;
    src.playbackRate.value = rate();
    src.connect(c.destination);
    src.onended = () => {
      setTime(duration);
      setPlaying(false);
      stopSource();
      setTime(duration);
    };
    src.start(0, from);
    startedAtCtxTime = c.currentTime;
    startOffset = from;
    setPlaying(true);
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing()) return;
    setTime(currentTime());
    setPlaying(false);
    stopSource();
  }

  function toggle() {
    playing() ? pause() : play();
  }

  function seek(t: number) {
    const target = clamp(t, 0, duration);
    if (playing()) {
      stopSource();
      setPlaying(false);
      setTime(target);
      play();
    } else {
      setTime(target);
    }
  }

  function setRate(r: number) {
    const target = clamp(r, 0.25, 4);
    if (target === rate()) return;
    if (playing() && ctx && src) {
      // Re-anchor the elapsed-time bookkeeping so currentTime() stays
      // continuous across the rate change.
      startOffset = currentTime();
      startedAtCtxTime = ctx.currentTime;
      src.playbackRate.value = target;
    }
    setRateSignal(target);
  }

  function destroy() {
    stopSource();
    setPlaying(false);
    void ctx?.close();
    ctx = null;
  }

  return { playing, time, duration, rate, setRate, play, pause, toggle, seek, destroy };
}

export type Player = ReturnType<typeof createPlayer>;
