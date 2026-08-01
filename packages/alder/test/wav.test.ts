import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRange, readWavInfo } from "../cli/wav";

/** 4 s of 16-bit mono at 100 Hz: silent except a ±0.8 block in second three. */
function makeWav(): Buffer {
  const frames = 400;
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const v = i >= 200 && i < 300 ? (i % 2 ? 0.8 : -0.8) : 0;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(100, 24);
  header.writeUInt32LE(200, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

let dir: string;
let path: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "alder-wav-"));
  path = join(dir, "test.wav");
  await writeFile(path, makeWav());
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("readWavInfo", () => {
  it("reads the format without loading the audio", async () => {
    const info = await readWavInfo(path);
    expect(info).toMatchObject({
      format: 1,
      channels: 1,
      sampleRate: 100,
      bits: 16,
      dataOffset: 44,
      frameCount: 400,
      durationSec: 4,
    });
  });

  it("rejects a file that isn't RIFF/WAVE", async () => {
    const bad = join(dir, "bad.wav");
    await writeFile(bad, Buffer.from("not a wav file at all"));
    await expect(readWavInfo(bad)).rejects.toThrow(/RIFF\/WAVE/);
  });
});

describe("parseRange", () => {
  it("handles the forms a media element actually sends", () => {
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=500-599", 1000)).toEqual({ start: 500, end: 599 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=900-99999", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("returns null for anything it shouldn't answer with a 206", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("bytes=600-500", 1000)).toBeNull();
    expect(parseRange("bytes=1000-1001", 1000)).toBeNull();
    expect(parseRange("items=0-10", 1000)).toBeNull();
  });
});
