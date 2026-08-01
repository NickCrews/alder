import { createSignal, type Accessor } from "solid-js";
import { clamp } from "./time";

/** Transport controls the UI drives, however the audio is actually sourced. */
export interface Player {
  playing: Accessor<boolean>;
  time: Accessor<number>;
  duration: number;
  rate: Accessor<number>;
  setRate(rate: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(time: number): void;
  destroy(): void;
}

/** Web Audio playback for a Float32Array. No-ops in environments without
 * AudioContext (e.g. jsdom). */
export function createBufferPlayer(audio: Float32Array, sampleRate: number): Player {
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

/** Playback straight from a URL. The browser streams and seeks with range
 * requests, so a three-hour file costs no memory here. `duration` is supplied
 * rather than read off the element, because the element only learns it after
 * metadata arrives — and for a long WAV that can be a whole download. */
export function createElementPlayer(url: string, duration: number): Player {
  const [playing, setPlaying] = createSignal(false);
  const [time, setTime] = createSignal(0);
  const [rate, setRateSignal] = createSignal(1);
  let raf = 0;

  const el = typeof Audio !== "undefined" ? new Audio() : null;
  if (el) {
    el.src = url;
    el.preload = "auto";
    el.addEventListener("ended", () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setTime(duration);
    });
    el.addEventListener("pause", () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
    });
  }

  function tick() {
    if (el) setTime(clamp(el.currentTime, 0, duration));
    if (playing()) raf = requestAnimationFrame(tick);
  }

  function play() {
    if (!el || playing()) return;
    if (el.currentTime >= duration - 0.01) el.currentTime = 0;
    void el.play().catch(() => setPlaying(false));
    setPlaying(true);
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    if (!el || !playing()) return;
    el.pause();
    setTime(clamp(el.currentTime, 0, duration));
    setPlaying(false);
    cancelAnimationFrame(raf);
  }

  return {
    playing,
    time,
    duration,
    rate,
    setRate(r) {
      const target = clamp(r, 0.25, 4);
      if (target === rate()) return;
      if (el) el.playbackRate = target;
      setRateSignal(target);
    },
    play,
    pause,
    toggle: () => (playing() ? pause() : play()),
    seek(t) {
      const target = clamp(t, 0, duration);
      setTime(target);
      if (el) el.currentTime = target;
    },
    destroy() {
      cancelAnimationFrame(raf);
      setPlaying(false);
      if (el) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
    },
  };
}
