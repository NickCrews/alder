import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createAnnotatorStore } from "../src/store";
import type { AnnotationState } from "../src/types";

function makeState(): AnnotationState {
  return {
    audio: new Float32Array(16000 * 10), // 10s of silence
    sampleRate: 16000,
    speakers: [
      { id: 0, label: "Alice" },
      { id: 1, label: "Bob" },
    ],
    segments: [
      {
        speaker_id: 0,
        words: [
          { timestamp: 1.0, text: "hello" },
          { timestamp: 1.5, text: "there" },
          { timestamp: 2.0, text: "world" },
        ],
      },
      { speaker_id: 0, words: [{ timestamp: 5.0, text: "again" }] },
    ],
  };
}

function withStore<T>(fn: (store: ReturnType<typeof createAnnotatorStore>) => T): T {
  return createRoot((dispose) => {
    const store = createAnnotatorStore(makeState());
    const result = fn(store);
    dispose();
    return result;
  });
}

describe("store ops", () => {
  it("clamps word drags between neighbors", () => {
    withStore((s) => {
      const key = s.doc.segments[0].key;
      s.beginOp();
      s.moveWord(key, 1, 5.0); // way past next word at 2.0
      s.endOp();
      expect(s.doc.segments[0].words[1].timestamp).toBeLessThan(2.0);
      expect(s.doc.segments[0].words[1].timestamp).toBeGreaterThan(1.0);
    });
  });

  it("translates whole segments, clamped to clip bounds", () => {
    withStore((s) => {
      const key = s.doc.segments[0].key;
      s.beginOp();
      s.moveSegment(key, -5); // would push first word to -4
      s.endOp();
      const words = s.doc.segments[0].words;
      expect(words[0].timestamp).toBe(0);
      expect(words[2].timestamp).toBeCloseTo(1.0); // relative spacing kept
    });
  });

  it("splits and merges segments", () => {
    withStore((s) => {
      const key = s.doc.segments[0].key;
      s.splitSegment(key, 1);
      expect(s.doc.segments.length).toBe(3);
      expect(s.getSeg(key)!.words.map((w) => w.text)).toEqual(["hello"]);
      s.mergeWithNext(key);
      expect(s.getSeg(key)!.words.map((w) => w.text)).toEqual(["hello", "there", "world"]);
    });
  });

  it("splits a word on whitespace with interpolated timestamps", () => {
    withStore((s) => {
      const key = s.doc.segments[0].key;
      s.commitWordText(key, 0, "hel lo"); // word spans 1.0 -> 1.5
      const words = s.getSeg(key)!.words;
      expect(words.map((w) => w.text)).toEqual(["hel", "lo", "there", "world"]);
      expect(words[0].timestamp).toBeCloseTo(1.0);
      expect(words[1].timestamp).toBeCloseTo(1.25);
    });
  });

  it("joins a word into its predecessor", () => {
    withStore((s) => {
      const key = s.doc.segments[0].key;
      s.joinWithPrev(key, 1);
      const words = s.getSeg(key)!.words;
      expect(words.map((w) => w.text)).toEqual(["hellothere", "world"]);
      expect(words[0].timestamp).toBeCloseTo(1.0);
    });
  });

  it("deletes the segment when its last word is deleted", () => {
    withStore((s) => {
      const key = s.doc.segments[1].key;
      s.deleteWord(key, 0);
      expect(s.getSeg(key)).toBeUndefined();
      expect(s.doc.segments.length).toBe(1);
    });
  });

  it("committing empty text deletes the word", () => {
    withStore((s) => {
      const key = s.doc.segments[0].key;
      s.commitWordText(key, 1, "   ");
      expect(s.getSeg(key)!.words.map((w) => w.text)).toEqual(["hello", "world"]);
    });
  });

  it("supports undo/redo", () => {
    withStore((s) => {
      const key = s.doc.segments[0].key;
      s.deleteSegment(key);
      expect(s.doc.segments.length).toBe(1);
      s.undo();
      expect(s.doc.segments.length).toBe(2);
      s.redo();
      expect(s.doc.segments.length).toBe(1);
    });
  });

  it("discards no-op undo snapshots", () => {
    withStore((s) => {
      s.beginOp();
      s.endOp(); // nothing changed
      expect(s.canUndo()).toBe(false);
    });
  });

  it("blocks deleting a speaker in use", () => {
    withStore((s) => {
      s.deleteSpeaker(0);
      expect(s.doc.speakers.length).toBe(2);
      s.deleteSpeaker(1); // Bob has no segments
      expect(s.doc.speakers.map((sp) => sp.id)).toEqual([0]);
    });
  });

  it("getState returns segments sorted by start time", () => {
    withStore((s) => {
      const key = s.doc.segments[1].key; // "again" at 5.0
      s.beginOp();
      s.moveSegment(key, -4.9);
      s.endOp();
      const out = s.getState();
      expect(out.segments[0].words[0].text).toBe("again");
    });
  });

  it("moves word selection across segment boundaries in time order", () => {
    withStore((s) => {
      const [segA, segB] = s.doc.segments;
      s.setSelection({ segKey: segA.key, wordIdx: 1 });
      s.selectAdjacentWord(1);
      expect(s.selection()).toEqual({ segKey: segA.key, wordIdx: 2 });
      s.selectAdjacentWord(1); // off the end of segA -> first word of segB
      expect(s.selection()).toEqual({ segKey: segB.key, wordIdx: 0 });
      s.selectAdjacentWord(1); // no segment after segB -> stays put
      expect(s.selection()).toEqual({ segKey: segB.key, wordIdx: 0 });
      s.selectAdjacentWord(-1); // back to last word of segA
      expect(s.selection()).toEqual({ segKey: segA.key, wordIdx: 2 });
    });
  });

  it("resolves a segment selection to its first/last word on arrow", () => {
    withStore((s) => {
      const segA = s.doc.segments[0];
      s.setSelection({ segKey: segA.key, wordIdx: null });
      s.selectAdjacentWord(1);
      expect(s.selection()).toEqual({ segKey: segA.key, wordIdx: 0 });
      s.setSelection({ segKey: segA.key, wordIdx: null });
      s.selectAdjacentWord(-1);
      expect(s.selection()).toEqual({ segKey: segA.key, wordIdx: 2 });
    });
  });

  it("requestWordEdit selects the word and exposes the request once", () => {
    withStore((s) => {
      const key = s.doc.segments[0].key;
      s.requestWordEdit(key, 1, "x");
      expect(s.selection()).toEqual({ segKey: key, wordIdx: 1 });
      expect(s.editRequest()).toEqual({ segKey: key, wordIdx: 1, seed: "x" });
      s.setEditRequest(null); // consumer (WordChip) clears it
      expect(s.editRequest()).toBeNull();
    });
  });

  it("fires onChange on committed ops only", () => {
    createRoot((dispose) => {
      let count = 0;
      const s = createAnnotatorStore(makeState(), () => count++);
      s.beginOp();
      s.moveWord(s.doc.segments[0].key, 0, 1.2);
      expect(count).toBe(0); // mid-drag
      s.endOp();
      expect(count).toBe(1);
      dispose();
    });
  });
});
