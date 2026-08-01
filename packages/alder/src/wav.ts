/** Browser-side WAV reading for range-streamed audio. The whole file never
 * loads: {@link parseWavHeader} reads geometry out of the first few KB, and
 * {@link decodeWindow} turns an arbitrary byte window of the data chunk into
 * mono float32. This is what lets the annotator draw and refine a waveform
 * against a dumb static server that only understands `Range` requests — no
 * server-side peak precompute, no metadata endpoint. */

function ascii(bytes: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(off, off + len));
}

export interface WavHeader {
  /** 1 = PCM int, 3 = IEEE float. */
  format: number;
  channels: number;
  sampleRate: number;
  bits: number;
  /** Byte offset of the first sample of the data chunk. */
  dataOffset: number;
  /** Byte length of the data chunk (whole frames only). */
  dataLength: number;
  bytesPerFrame: number;
  frameCount: number;
  durationSec: number;
}

/** Raised when the `data` chunk begins past the end of the prefix we were
 * handed — the caller should fetch a larger head and retry. Rare: WAV headers
 * are tens of bytes, but a stray metadata chunk before `data` could push it
 * out. `neededBytes` is how far in the `data` body starts. */
export class WavHeaderTruncated extends Error {
  constructor(readonly neededBytes: number) {
    super(`WAV header extends past the prefix; need at least ${neededBytes} bytes`);
    this.name = "WavHeaderTruncated";
  }
}

/** Parse WAV geometry from a prefix of the file. `fileSize` (from a range
 * response's `Content-Range` total, say) fills in the data length when the
 * header declares a bogus one, which streamed/piped WAVs sometimes do. */
export function parseWavHeader(bytes: Uint8Array, fileSize?: number): WavHeader {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = fileSize ?? bytes.length;

  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOffset = -1;
  let declaredDataLen = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, 4);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      let format = dv.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE hides the real format in the GUID's first word.
      if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true);
      fmt = {
        format,
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataOffset = body;
      declaredDataLen = size;
      break; // samples follow; nothing after them we need from the header
    }
    off = body + size + (size % 2);
  }

  if (!fmt || !fmt.sampleRate || !fmt.channels || !fmt.bits) {
    throw new Error("Malformed WAV: missing or unreadable fmt chunk");
  }
  if (dataOffset < 0) {
    if (off + 8 > bytes.length) throw new WavHeaderTruncated(off + 8);
    throw new Error("Malformed WAV: no data chunk");
  }

  const bytesPerFrame = (fmt.bits / 8) * fmt.channels;
  const maxLen = total - dataOffset;
  // Trust the file length over a bogus (zero / 0xffffffff) declared size.
  const dataLen =
    declaredDataLen === 0 || declaredDataLen === 0xffffffff
      ? maxLen
      : Math.min(declaredDataLen, maxLen);
  const frameCount = Math.floor(dataLen / bytesPerFrame);
  return {
    ...fmt,
    dataOffset,
    dataLength: frameCount * bytesPerFrame,
    bytesPerFrame,
    frameCount,
    durationSec: frameCount / fmt.sampleRate,
  };
}

/** One-frame reader for the header's encoding, normalised to [-1, 1] and
 * averaged to mono. `frameByte` is the byte offset of the frame within `dv`. */
export function frameDecoder(h: WavHeader): (dv: DataView, frameByte: number) => number {
  const { format, bits, channels } = h;
  const sampleBytes = bits / 8;
  const read: (dv: DataView, o: number) => number =
    format === 3 && bits === 32
      ? (dv, o) => dv.getFloat32(o, true)
      : format === 3 && bits === 64
        ? (dv, o) => dv.getFloat64(o, true)
        : format === 1 && bits === 16
          ? (dv, o) => dv.getInt16(o, true) / 32768
          : format === 1 && bits === 32
            ? (dv, o) => dv.getInt32(o, true) / 2147483648
            : format === 1 && bits === 24
              ? (dv, o) => {
                  const v = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
                  return (v > 0x7fffff ? v - 0x1000000 : v) / 8388608;
                }
              : format === 1 && bits === 8
                ? (dv, o) => (dv.getUint8(o) - 128) / 128
                : null!;
  if (!read) throw new Error(`Unsupported WAV encoding: format=${format} bits=${bits}`);
  if (channels === 1) return (dv, frameByte) => read(dv, frameByte);
  return (dv, frameByte) => {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read(dv, frameByte + c * sampleBytes);
    return sum / channels;
  };
}

/** Decode a byte window of the data chunk into mono float32. `windowBytes`
 * must start on a frame boundary relative to the data chunk — i.e. it is the
 * response to a range request whose start was `dataOffset + firstFrame *
 * bytesPerFrame`. Trailing bytes that don't complete a frame are ignored. */
export function decodeWindow(windowBytes: Uint8Array, h: WavHeader): Float32Array {
  const dv = new DataView(windowBytes.buffer, windowBytes.byteOffset, windowBytes.byteLength);
  const decode = frameDecoder(h);
  const frames = Math.floor(windowBytes.length / h.bytesPerFrame);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) out[f] = decode(dv, f * h.bytesPerFrame);
  return out;
}
