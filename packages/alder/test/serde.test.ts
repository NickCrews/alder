import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  decodeAudioBytes,
  parseAnnotation,
  serializeAnnotation,
} from "../src/serde";
import type { AnnotationState } from "../src/types";

function makeState(): AnnotationState {
  return {
    speakers: [
      { id: 0, label: "Alice" },
      { id: 1, label: "Bob" },
    ],
    segments: [
      {
        speaker_id: 0,
        words: [
          { timestamp: 0.1, text: "hello" },
          { timestamp: 0.5, text: "world" },
        ],
      },
      { speaker_id: 1, words: [{ timestamp: 1.0, text: "hi" }] },
    ],
  };
}

function makeWav(samples: number[], sampleRate: number, channels = 1): Uint8Array {
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  dv.setUint32(4, 36 + dataLen, true);
  w(8, "WAVE");
  w(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM int
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * 2, true);
  dv.setUint16(32, channels * 2, true);
  dv.setUint16(34, 16, true);
  w(36, "data");
  dv.setUint32(40, dataLen, true);
  samples.forEach((s, i) => dv.setInt16(44 + i * 2, Math.round(s * 32767), true));
  return new Uint8Array(buf);
}

describe("base64", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe("serialize/parse", () => {
  it("round-trips an annotation through the wire format", () => {
    const state = makeState();
    const json = serializeAnnotation(state);
    const back = parseAnnotation(JSON.stringify(json));
    expect(back.speakers).toEqual(state.speakers);
    expect(back.segments).toEqual(state.segments);
  });

  it("carries no audio in the annotation format", () => {
    const json = serializeAnnotation(makeState()) as unknown as Record<string, unknown>;
    expect(json.audio).toBeUndefined();
    expect(json.sample_rate).toBeUndefined();
  });

  it("sorts words defensively on parse", () => {
    const json = serializeAnnotation(makeState());
    json.segments[0].words.reverse();
    const back = parseAnnotation(json);
    expect(back.segments[0].words.map((w) => w.text)).toEqual(["hello", "world"]);
  });
});

describe("audio decoding", () => {
  it("decodes 16-bit mono PCM", () => {
    const wav = makeWav([0, 0.5, -0.5], 22050);
    const { audio, sampleRate } = decodeAudioBytes(wav);
    expect(sampleRate).toBe(22050);
    expect(audio.length).toBe(3);
    expect(audio[1]).toBeCloseTo(0.5, 2);
    expect(audio[2]).toBeCloseTo(-0.5, 2);
  });

  it("downmixes stereo to mono", () => {
    // L=1, R=0 for one frame -> 0.5
    const wav = makeWav([1, 0], 8000, 2);
    const { audio } = decodeAudioBytes(wav);
    expect(audio.length).toBe(1);
    expect(audio[0]).toBeCloseTo(0.5, 2);
  });

  it("decodes raw float32 given a sample rate", () => {
    const raw = new Uint8Array(new Float32Array([0, 0.25, -0.25, 0.5]).buffer);
    const { audio, sampleRate } = decodeAudioBytes(raw, 8000);
    expect(sampleRate).toBe(8000);
    expect(Array.from(audio)).toEqual([0, 0.25, -0.25, 0.5]);
  });

  it("rejects raw float32 without a sample rate", () => {
    const raw = new Uint8Array(new Float32Array([0, 0.25]).buffer);
    expect(() => decodeAudioBytes(raw)).toThrow(/sample_rate/);
  });
});
