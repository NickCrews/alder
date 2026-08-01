import { createSignal, type Accessor } from "solid-js";
import { createBufferPlayer, createElementPlayer, type Player } from "./player";
import { decodeAudioBytes, isWav } from "./serde";
import { decodeWindow, parseWavHeader, WavHeaderTruncated, type WavHeader } from "./wav";

/** Column-wise min/max envelope, the only thing the waveform ever needs. */
export interface Peaks {
  mins: Float32Array;
  maxs: Float32Array;
}

/** Where an annotator gets its audio. {@link bufferSource} holds samples in
 * memory; {@link urlSource} streams a WAV from a static URL over `Range`
 * requests, pulling only the bytes the current view needs. */
export interface AudioSource {
  readonly duration: number;
  readonly sampleRate: number;
  /** Bumped when freshly-arrived data would change what `peaks` returns. Read
   * it inside a reactive scope to redraw. */
  readonly version: Accessor<number>;
  /** Envelope over `[start, end)` split into `columns` columns. Synchronous
   * and best-effort: a streaming source answers from whatever it has cached. */
  peaks(start: number, end: number, columns: number): Peaks;
  /** Hint that this span is about to be drawn, so finer data can be fetched. */
  prefetch(start: number, end: number): void;
  createPlayer(): Player;
  destroy(): void;
}

const MIP_BLOCK = 128;

/** Precomputed min/max over fixed blocks, so drawing a zoomed-out view doesn't
 * touch every sample. */
function buildMipmap(audio: Float32Array, block: number): Peaks {
  const n = Math.ceil(audio.length / block);
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = Infinity;
    let hi = -Infinity;
    const end = Math.min((b + 1) * block, audio.length);
    for (let i = b * block; i < end; i++) {
      const v = audio[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    mins[b] = lo === Infinity ? 0 : lo;
    maxs[b] = hi === -Infinity ? 0 : hi;
  }
  return { mins, maxs };
}

/** Scan `[s0, s1)` of a sample array, or of a mipmap when the span is wide
 * enough that block resolution is invisible. */
function envelope(
  audio: Float32Array,
  mip: Peaks,
  block: number,
  s0: number,
  s1: number,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  if (s1 - s0 > block * 2) {
    const b0 = Math.floor(s0 / block);
    const b1 = Math.min(mip.mins.length, Math.ceil(s1 / block));
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
  return [lo, hi];
}

/** All samples in memory — the classic path, used whenever the caller already
 * holds decoded audio. Async only so it shares one shape with the sources that
 * genuinely fetch ({@link urlSource}); the work here is synchronous and the
 * promise settles in the same tick. */
export async function bufferSource(
  audio: Float32Array,
  sampleRate: number,
): Promise<AudioSource> {
  const mip = buildMipmap(audio, MIP_BLOCK);
  const version = () => 0;
  return {
    duration: audio.length / sampleRate,
    sampleRate,
    version,
    peaks(start, end, columns) {
      const mins = new Float32Array(columns);
      const maxs = new Float32Array(columns);
      const dur = end - start;
      for (let col = 0; col < columns; col++) {
        const s0 = Math.max(0, Math.floor((start + (col / columns) * dur) * sampleRate));
        const s1 = Math.min(audio.length, Math.ceil((start + ((col + 1) / columns) * dur) * sampleRate));
        if (s1 <= s0) continue;
        const [lo, hi] = envelope(audio, mip, MIP_BLOCK, s0, s1);
        if (lo !== Infinity) {
          mins[col] = lo;
          maxs[col] = hi;
        }
      }
      return { mins, maxs };
    },
    prefetch() { },
    createPlayer: () => createBufferPlayer(audio, sampleRate),
    destroy() { },
  };
}

/** Decode WAV or raw float32 bytes and hold the samples in memory. Raw
 * (non-WAV) float32 needs `fallbackSampleRate`. */
export async function bufferSourceFromBytes(
  bytes: Uint8Array,
  fallbackSampleRate?: number,
): Promise<AudioSource> {
  const { audio, sampleRate } = decodeAudioBytes(bytes, fallbackSampleRate);
  return bufferSource(audio, sampleRate);
}

interface FineWindow {
  /** Window bounds in seconds, snapped to frame boundaries. */
  start: number;
  end: number;
  audio: Float32Array;
  mip: Peaks;
}

/** At or below this we just download and decode the whole file: one request
 * beats hundreds of range probes and the envelope comes out exact. */
const WHOLE_FILE_LIMIT = 8 * 1024 * 1024;
/** Header probe size — comfortably past any real WAV header. */
const HEADER_PROBE = 64 * 1024;
/** Approximate-overview resolution: this many strided probes across the file. */
const OVERVIEW_PROBES = 256;
/** Frames decoded per overview probe (caps bytes pulled per probe). */
const OVERVIEW_PROBE_FRAMES = 8192;
/** Range requests kept in flight while the overview builds. */
const OVERVIEW_CONCURRENCY = 8;
/** Widest span (seconds) we pull exact samples for on zoom. */
const MAX_FINE_SPAN = 120;

/** Total file size from a range response's `Content-Range`, if present. */
function rangeTotal(res: Response): number | null {
  const m = /\/(\d+)\s*$/.exec(res.headers.get("Content-Range") ?? "");
  return m ? Number(m[1]) : null;
}

/** Point the annotator at a single audio URL and nothing else — no metadata,
 * no precomputed peaks, no smart endpoint. All the server has to do is serve
 * the file and honour `Range`, which object stores, GitHub Pages, and any
 * static host already do.
 *
 * For a WAV big enough to be worth streaming, the geometry (duration, sample
 * rate) is read from the header with one small range request; the zoomed-out
 * waveform is approximated by striding a few hundred more probes across the
 * file, and refined to exact by pulling the visible bytes as you zoom in.
 * Playback is an `<audio>` element on the same URL, so the browser streams and
 * seeks. Small files, non-WAV bytes, or hosts that ignore `Range` fall back to
 * downloading and decoding the whole thing (see {@link bufferSourceFromBytes}).
 *
 * The promise settles once the audio is playable and its duration is known;
 * the overview streams in afterward, bumping `version` as probes land. */
export async function urlSource(url: string): Promise<AudioSource> {
  const probe = await fetch(url, { headers: { Range: `bytes=0-${HEADER_PROBE - 1}` } });
  if (!probe.ok && probe.status !== 206) throw new Error(`audio request failed: ${probe.status}`);
  const head = new Uint8Array(await probe.arrayBuffer());
  const total = rangeTotal(probe) ?? head.length;
  const ranged = probe.status === 206;

  // Small, un-rangeable, or not a streamable WAV: decode it whole. When the
  // host ignored the range (200), `head` already holds the entire file.
  if (!ranged || total <= WHOLE_FILE_LIMIT || !isWav(head)) {
    const bytes =
      head.length >= total ? head : new Uint8Array(await (await fetch(url)).arrayBuffer());
    return bufferSourceFromBytes(bytes);
  }

  let header: WavHeader;
  try {
    header = parseWavHeader(head, total);
  } catch (err) {
    if (!(err instanceof WavHeaderTruncated)) throw err;
    // A metadata chunk pushed `data` past our probe — widen once and retry.
    const wide = await fetch(url, { headers: { Range: `bytes=0-${err.neededBytes + 4096 - 1}` } });
    header = parseWavHeader(new Uint8Array(await wide.arrayBuffer()), total);
  }
  return wavRangeSource(url, header);
}

/** A WAV streamed straight from a static URL over `Range` requests. Nothing but
 * the bytes the current view needs ever crosses the wire. Exposed for callers
 * that already know the geometry (and for tests); most reach it via
 * {@link urlSource}, which probes the header first. */
export function wavRangeSource(url: string, header: WavHeader): AudioSource {
  const { sampleRate, dataOffset, dataLength, bytesPerFrame, frameCount } = header;
  const duration = header.durationSec;
  const [version, setVersion] = createSignal(0);
  const bump = () => setVersion((v) => v + 1);

  // Overview: one bucket per strided probe across the whole file. A bucket is
  // exact within its probe window and blind between windows — fine zoomed out,
  // and every visible span gets refined to real samples once it's narrow enough.
  const buckets = Math.max(1, Math.min(OVERVIEW_PROBES, frameCount));
  const coarse: Peaks = { mins: new Float32Array(buckets), maxs: new Float32Array(buckets) };
  const bucketSec = duration / buckets;

  let fine: FineWindow | null = null;
  let pendingFine: string | null = null;
  let alive = true;

  /** Range-read `frames` frames starting at data-frame `first`, decoded to mono. */
  async function readFrames(first: number, frames: number): Promise<Float32Array> {
    const startByte = dataOffset + first * bytesPerFrame;
    const endByte = Math.min(dataOffset + dataLength, startByte + frames * bytesPerFrame) - 1;
    if (endByte < startByte) return new Float32Array(0);
    const res = await fetch(url, { headers: { Range: `bytes=${startByte}-${endByte}` } });
    if (!res.ok && res.status !== 206) throw new Error(`audio request failed: ${res.status}`);
    return decodeWindow(new Uint8Array(await res.arrayBuffer()), header);
  }

  // Kick the approximate overview off immediately; workers share a cursor.
  void (async () => {
    const framesPerBucket = frameCount / buckets;
    const probeFrames = Math.max(1, Math.min(OVERVIEW_PROBE_FRAMES, Math.ceil(framesPerBucket)));
    let cursor = 0;
    const worker = async () => {
      for (let b = cursor++; b < buckets && alive; b = cursor++) {
        try {
          const audio = await readFrames(Math.floor(b * framesPerBucket), probeFrames);
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = 0; i < audio.length; i++) {
            if (audio[i] < lo) lo = audio[i];
            if (audio[i] > hi) hi = audio[i];
          }
          if (lo !== Infinity) {
            coarse.mins[b] = lo;
            coarse.maxs[b] = hi;
            bump();
          }
        } catch {
          /* leave this bucket flat; the overview is best-effort */
        }
      }
    };
    await Promise.all(Array.from({ length: OVERVIEW_CONCURRENCY }, worker));
  })();

  async function fetchFine(startSec: number, endSec: number): Promise<void> {
    const first = Math.max(0, Math.floor(startSec * sampleRate));
    const last = Math.min(frameCount, Math.ceil(endSec * sampleRate));
    const key = `${first}-${last}`;
    if (pendingFine === key || last <= first) return;
    pendingFine = key;
    try {
      const audio = await readFrames(first, last - first);
      if (!alive || pendingFine !== key) return; // a newer view won the race
      fine = { start: first / sampleRate, end: last / sampleRate, audio, mip: buildMipmap(audio, MIP_BLOCK) };
      bump();
    } catch {
      /* a failed fine read just leaves the coarse overview showing */
    } finally {
      if (pendingFine === key) pendingFine = null;
    }
  }

  return {
    duration,
    sampleRate,
    version,
    peaks(start, end, columns) {
      version(); // subscribe: a redraw must follow every arrival
      const mins = new Float32Array(columns);
      const maxs = new Float32Array(columns);
      const dur = end - start;
      const f = fine;
      const useFine = f && start >= f.start && end <= f.end;

      for (let col = 0; col < columns; col++) {
        const t0 = start + (col / columns) * dur;
        const t1 = start + ((col + 1) / columns) * dur;
        let lo = Infinity;
        let hi = -Infinity;

        if (useFine && f) {
          const s0 = Math.max(0, Math.floor((t0 - f.start) * sampleRate));
          const s1 = Math.min(f.audio.length, Math.ceil((t1 - f.start) * sampleRate));
          if (s1 > s0) [lo, hi] = envelope(f.audio, f.mip, MIP_BLOCK, s0, s1);
        } else {
          const b0 = Math.max(0, Math.floor(t0 / bucketSec));
          const b1 = Math.min(coarse.mins.length, Math.max(b0 + 1, Math.ceil(t1 / bucketSec)));
          for (let b = b0; b < b1; b++) {
            if (coarse.mins[b] < lo) lo = coarse.mins[b];
            if (coarse.maxs[b] > hi) hi = coarse.maxs[b];
          }
        }
        if (lo !== Infinity) {
          mins[col] = lo;
          maxs[col] = hi;
        }
      }
      return { mins, maxs };
    },
    prefetch(start, end) {
      const span = end - start;
      if (span > MAX_FINE_SPAN) return; // too wide to cover with one exact window
      if (fine && start >= fine.start && end <= fine.end) return;
      // Pad so small pans stay inside the cached window, but never past the cap.
      const pad = Math.min(MAX_FINE_SPAN, Math.max(span * 3, 10));
      const mid = (start + end) / 2;
      const s = Math.max(0, Math.min(mid - pad / 2, duration - pad));
      void fetchFine(s, s + pad);
    },
    createPlayer: () => createElementPlayer(url, duration),
    destroy() {
      alive = false;
      fine = null;
    },
  };
}
