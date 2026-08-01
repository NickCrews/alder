import { describe, expect, it } from "vitest";
import { decodeWindow, parseWavHeader, WavHeaderTruncated } from "../src/wav";

/** 16-bit mono WAV; `fill(i)` gives each frame's value in [-1, 1]. An optional
 * `junk` byte count inserts a dummy chunk before `data`, to push it deep. */
function wav(frames: number, sampleRate: number, fill: (i: number) => number, junk = 0): Uint8Array {
  const junkChunk = junk ? 8 + junk : 0;
  const buf = new ArrayBuffer(44 + junkChunk + frames * 2);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, buf.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  let off = 36;
  if (junk) {
    str(off, "JUNK");
    dv.setUint32(off + 4, junk, true);
    off += 8 + junk;
  }
  str(off, "data");
  dv.setUint32(off + 4, frames * 2, true);
  const dataStart = off + 8;
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, fill(i)));
    dv.setInt16(dataStart + i * 2, v < 0 ? v * 32768 : v * 32767, true);
  }
  return new Uint8Array(buf);
}

/** 4 s at 100 Hz: silent except a ±0.8 block in the third second. */
const loudInThird = (i: number) => (i >= 200 && i < 300 ? (i % 2 ? 0.8 : -0.8) : 0);

describe("parseWavHeader", () => {
  it("reads geometry from the header alone", () => {
    const h = parseWavHeader(wav(400, 100, loudInThird));
    expect(h).toMatchObject({
      format: 1,
      channels: 1,
      sampleRate: 100,
      bits: 16,
      dataOffset: 44,
      bytesPerFrame: 2,
      frameCount: 400,
      durationSec: 4,
    });
  });

  it("trusts the file size over a bogus (streamed) data length", () => {
    const bytes = wav(400, 100, loudInThird);
    new DataView(bytes.buffer).setUint32(40, 0xffffffff, true); // data size = -1
    const h = parseWavHeader(bytes, bytes.length);
    expect(h.frameCount).toBe(400);
  });

  it("rejects non-RIFF bytes", () => {
    expect(() => parseWavHeader(new Uint8Array(20))).toThrow(/RIFF\/WAVE/);
  });

  it("asks for more bytes when data starts past the prefix", () => {
    const bytes = wav(10, 100, () => 0, 200); // a 200-byte JUNK chunk before data
    // Hand over only enough to see fmt + the JUNK header, not the data chunk.
    expect(() => parseWavHeader(bytes.subarray(0, 44), bytes.length)).toThrow(WavHeaderTruncated);
  });
});

describe("decodeWindow", () => {
  it("decodes a byte window of the data chunk to mono float32", () => {
    const bytes = wav(400, 100, loudInThird);
    const h = parseWavHeader(bytes);
    // The loud third second: frames 200..299, i.e. data bytes [400, 600).
    const window = bytes.subarray(h.dataOffset + 200 * 2, h.dataOffset + 300 * 2);
    const audio = decodeWindow(window, h);
    expect(audio.length).toBe(100);
    expect(Math.abs(audio[0])).toBeCloseTo(0.8, 3);
  });

  it("ignores a trailing partial frame", () => {
    const bytes = wav(400, 100, loudInThird);
    const h = parseWavHeader(bytes);
    // 5 bytes = two whole 2-byte frames plus a dangling byte.
    const audio = decodeWindow(bytes.subarray(h.dataOffset, h.dataOffset + 5), h);
    expect(audio.length).toBe(2);
  });
});
