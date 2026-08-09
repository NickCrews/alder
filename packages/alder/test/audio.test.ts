import { afterEach, describe, expect, it, vi } from "vitest";
import { bufferSource, urlSource, wavRangeSource } from "../src/audio";
import { parseWavHeader } from "../src/wav";

/** 4 s at 100 Hz: silence, then a loud block in the third second. */
function makeAudio(): Float32Array {
  const audio = new Float32Array(400);
  for (let i = 200; i < 300; i++) audio[i] = i % 2 ? 0.8 : -0.8;
  return audio;
}

/** 16-bit mono WAV holding `samples`. */
function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
  }
  return new Uint8Array(buf);
}

describe("bufferSource", () => {
  it("is ready on construction, with duration from the sample count", () => {
    expect(bufferSource(makeAudio(), 100).geometry()).toEqual({
      state: "known",
      duration: 4,
      sampleRate: 100,
    });
  });

  it("puts the envelope only where the signal is", () => {
    const src = bufferSource(makeAudio(), 100);
    const { mins, maxs } = src.peaks(0, 4, 4);
    expect([mins[0], maxs[0]]).toEqual([0, 0]);
    expect([mins[1], maxs[1]]).toEqual([0, 0]);
    expect(maxs[2]).toBeCloseTo(0.8, 5);
    expect(mins[2]).toBeCloseTo(-0.8, 5);
    expect([mins[3], maxs[3]]).toEqual([0, 0]);
  });

  it("agrees with itself across zoom levels", () => {
    const src = bufferSource(makeAudio(), 100);
    // One column over the loud second, whether reached wide or narrow.
    expect(src.peaks(2, 3, 1).maxs[0]).toBeCloseTo(src.peaks(0, 4, 4).maxs[2], 5);
  });
});

/** A `fetch` stub that serves `file` bytes with `Range` support, the way a
 * static host does. `ignoreRange` models a host that answers 200 with the whole
 * body instead of 206 — the case the source must fall back on. */
function rangeServer(file: Uint8Array, ignoreRange = false) {
  const ranges: string[] = [];
  const headers = (contentRange: string | null) => ({
    get: (h: string) => (h.toLowerCase() === "content-range" ? contentRange : null),
  });
  const body = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

  vi.stubGlobal("fetch", (_url: string, init?: { headers?: Record<string, string> }) => {
    const range = init?.headers?.Range;
    if (!range || ignoreRange) {
      ranges.push("full");
      return Promise.resolve({ ok: true, status: 200, headers: headers(null), arrayBuffer: () => Promise.resolve(body(file)) });
    }
    const m = /bytes=(\d+)-(\d+)/.exec(range)!;
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), file.length - 1);
    ranges.push(`${start}-${end}`);
    return Promise.resolve({
      ok: true,
      status: 206,
      headers: headers(`bytes ${start}-${end}/${file.length}`),
      arrayBuffer: () => Promise.resolve(body(file.subarray(start, end + 1))),
    });
  });
  return ranges;
}

describe("urlSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hands back a usable source before the header has landed", () => {
    rangeServer(wavBytes(makeAudio(), 100));
    const src = urlSource("/audio.wav");
    // Nothing awaited: the source exists, says so, and answers a flat envelope
    // rather than making the caller wait for one.
    expect(src.geometry()).toEqual({ state: "pending" });
    expect(src.duration()).toBe(null);
    expect(Array.from(src.peaks(0, 4, 2).maxs)).toEqual([0, 0]);
    expect(() => src.createPlayer()).not.toThrow();
  });

  it("downloads and decodes a small file whole (exact envelope)", async () => {
    const ranges = rangeServer(wavBytes(makeAudio(), 100));
    const src = urlSource("/audio.wav");
    await vi.waitFor(() => expect(src.duration()).toBe(4));
    // Small file (844 bytes): the header probe already returned everything, no
    // second request.
    expect(ranges).toEqual(["0-843"]);
    expect(src.peaks(2, 3, 1).maxs[0]).toBeCloseTo(0.8, 3);
  });

  it("falls back to a whole-file download when the host ignores Range", async () => {
    rangeServer(wavBytes(makeAudio(), 100), true);
    const src = urlSource("/audio.wav");
    await vi.waitFor(() => expect(src.duration()).toBe(4));
    expect(src.peaks(2, 3, 1).maxs[0]).toBeCloseTo(0.8, 3);
  });

  it("reports a failed fetch as its own state rather than throwing", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404 }));
    const src = urlSource("/missing.wav");
    await vi.waitFor(() =>
      expect(src.geometry()).toMatchObject({
        state: "failed",
        error: expect.objectContaining({ message: expect.stringMatching(/audio request failed: 404/) }),
      }),
    );
    // Still a source: it just has nothing to show.
    expect(src.duration()).toBe(null);
    expect(Array.from(src.peaks(0, 4, 2).maxs)).toEqual([0, 0]);
  });
});

describe("wavRangeSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 200 s at 100 Hz (20k frames): a loud ±0.8 block across seconds 100–101. */
  function longWav(): Uint8Array {
    const frames = 20000;
    const s = new Float32Array(frames);
    for (let i = 10000; i < 10100; i++) s[i] = i % 2 ? 0.8 : -0.8;
    return wavBytes(s, 100);
  }

  it("reads geometry from the header and streams the overview in", async () => {
    const file = longWav();
    rangeServer(file);
    const src = wavRangeSource("/audio.wav", parseWavHeader(file, file.length));
    expect(src.geometry()).toEqual({ state: "known", duration: 200, sampleRate: 100 });
    // The overview arrives probe by probe; wait for the loud region to register.
    await vi.waitFor(() => expect(src.peaks(100, 101, 1).maxs[0]).toBeGreaterThan(0.5));
  });

  it("refines a narrow view to exact samples on prefetch", async () => {
    const file = longWav();
    rangeServer(file);
    const src = wavRangeSource("/audio.wav", parseWavHeader(file, file.length));
    // A 1 s window is well under the fine-span cap, so it becomes exact.
    src.prefetch(100, 101);
    await vi.waitFor(() => {
      const { mins, maxs } = src.peaks(100, 101, 10);
      expect(maxs[0]).toBeCloseTo(0.8, 2);
      expect(mins[0]).toBeCloseTo(-0.8, 2);
    });
  });
});
