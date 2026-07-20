import type { AnnotationJSON, AnnotationState, Segment, Speaker } from "./types";

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function ascii(bytes: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(off, off + len));
}

export function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WAVE"
  );
}

/** Parse a WAV file into mono float32 (multi-channel is averaged).
 * Supports PCM int 8/16/24/32 and float32. */
export function parseWav(bytes: Uint8Array): { audio: Float32Array; sampleRate: number } {
  if (!isWav(bytes)) throw new Error("Not a WAV file");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, 4);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataOff = body;
      dataLen = Math.min(size, bytes.length - body);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new Error("Malformed WAV: missing fmt or data chunk");
  const { format, channels, sampleRate, bits } = fmt;
  const bytesPerSample = bits / 8;
  const frameCount = Math.floor(dataLen / (bytesPerSample * channels));
  const audio = new Float32Array(frameCount);
  const read = (o: number): number => {
    if (format === 3 && bits === 32) return dv.getFloat32(o, true);
    if (format === 1 && bits === 16) return dv.getInt16(o, true) / 32768;
    if (format === 1 && bits === 32) return dv.getInt32(o, true) / 2147483648;
    if (format === 1 && bits === 24) {
      const v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
      return (v > 0x7fffff ? v - 0x1000000 : v) / 8388608;
    }
    if (format === 1 && bits === 8) return (bytes[o] - 128) / 128;
    throw new Error(`Unsupported WAV encoding: format=${format} bits=${bits}`);
  };
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    const frame = dataOff + i * bytesPerSample * channels;
    for (let c = 0; c < channels; c++) sum += read(frame + c * bytesPerSample);
    audio[i] = sum / channels;
  }
  return { audio, sampleRate };
}

/** Decode audio bytes: WAV (sniffed) or raw little-endian float32 PCM. */
export function decodeAudioBytes(
  bytes: Uint8Array,
  fallbackSampleRate?: number,
): { audio: Float32Array; sampleRate: number } {
  if (isWav(bytes)) return parseWav(bytes);
  if (bytes.length % 4 !== 0) {
    throw new Error("Audio is neither WAV nor raw float32 (byte length not divisible by 4)");
  }
  if (fallbackSampleRate == null) {
    throw new Error("Raw float32 audio requires a sample_rate field");
  }
  // Copy so alignment is guaranteed regardless of the source buffer's offset.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { audio: new Float32Array(buf), sampleRate: fallbackSampleRate };
}

function cloneSegments(segments: Segment[]): Segment[] {
  return segments.map((s) => ({
    speaker_id: s.speaker_id,
    words: [...s.words]
      .map((w) => ({ timestamp: w.timestamp, text: String(w.text) }))
      .sort((a, b) => a.timestamp - b.timestamp),
  }));
}

export function parseAnnotation(input: string | AnnotationJSON): AnnotationState {
  const json: AnnotationJSON = typeof input === "string" ? JSON.parse(input) : input;
  if (typeof json.audio !== "string") throw new Error("Missing base64 audio field");
  const { audio, sampleRate } = decodeAudioBytes(base64ToBytes(json.audio), json.sample_rate);
  const speakers: Speaker[] = (json.speakers ?? []).map((s) => ({
    id: s.id,
    label: String(s.label),
  }));
  return { audio, sampleRate, speakers, segments: cloneSegments(json.segments ?? []) };
}

export function serializeAnnotation(state: AnnotationState): AnnotationJSON {
  const bytes = new Uint8Array(
    state.audio.buffer.slice(
      state.audio.byteOffset,
      state.audio.byteOffset + state.audio.byteLength,
    ),
  );
  return {
    sample_rate: state.sampleRate,
    audio: bytesToBase64(bytes),
    speakers: state.speakers.map((s) => ({ id: s.id, label: s.label })),
    segments: cloneSegments(state.segments),
  };
}

export function serializeAnnotationString(state: AnnotationState): string {
  return JSON.stringify(serializeAnnotation(state));
}
