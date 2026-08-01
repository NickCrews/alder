/** Node-side WAV handling for the static file server. The server itself does no
 * sample-level work — the waveform envelope and zoomed-in detail are computed in
 * the browser straight off `Range` requests. All that's left here is {@link
 * readWavInfo}, which reads the header (reusing the browser's {@link
 * parseWavHeader}) for a friendly startup log and the file size range-serving
 * needs, and {@link parseRange}, which turns a `Range` header into byte bounds. */

import { open } from "node:fs/promises";
import { parseWavHeader, WavHeaderTruncated, type WavHeader } from "../src/wav";

/** How much of the file to pull looking for the header. Comfortably past any
 * real WAV header; widened on the rare `data`-chunk-pushed-out file. */
const HEADER_PROBE = 64 * 1024;

export interface WavInfo extends WavHeader {
  path: string;
  /** File size in bytes. */
  size: number;
}

/** Read WAV geometry without loading the audio: stat for the size, then decode
 * the header out of a prefix with the same parser the browser uses. */
export async function readWavInfo(path: string): Promise<WavInfo> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const read = async (len: number): Promise<Uint8Array> => {
      const buf = Buffer.alloc(Math.min(len, size));
      await fh.read(buf, 0, buf.length, 0);
      return buf;
    };
    let header: WavHeader;
    try {
      header = parseWavHeader(await read(HEADER_PROBE), size);
    } catch (err) {
      if (!(err instanceof WavHeaderTruncated)) throw err;
      header = parseWavHeader(await read(err.neededBytes + 4096), size);
    }
    return { path, size, ...header };
  } finally {
    await fh.close();
  }
}

/** Parse a single `Range: bytes=a-b` header against a known size. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  let start: number;
  let end: number; // inclusive
  if (rawStart === "") {
    const len = Number(rawEnd);
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}
