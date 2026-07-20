import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createAnnotatorStore } from "../src/store";
import { runsToHtml, runsToText, tokenize } from "../src/clipboard";
import type { AnnotationState } from "../src/types";

/** Alice speaks three words, then Bob one. 10s of audio, and every gap is
 * 0.5s — so the median word gap, and every duration derived from it, is 0.5s. */
function makeState(): AnnotationState {
  return {
    audio: new Float32Array(16000 * 10),
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
      { speaker_id: 1, words: [{ timestamp: 5.0, text: "again" }] },
    ],
  };
}

type Store = ReturnType<typeof createAnnotatorStore>;

function withStore<T>(fn: (store: Store) => T): T {
  return createRoot((dispose) => {
    const store = createAnnotatorStore(makeState());
    const result = fn(store);
    dispose();
    return result;
  });
}

const keys = (s: Store) => s.doc.segments.map((seg) => seg.key);
const texts = (s: Store) => s.doc.segments.map((seg) => seg.words.map((w) => w.text));
const times = (s: Store, i: number) => s.doc.segments[i].words.map((w) => w.timestamp);

describe("copy", () => {
  it("joins loose words with spaces and leaves them unlabeled", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.toggleSelected({ segKey: a, wordIdx: 1 });
      const runs = s.copyRuns();
      expect(runsToText(runs)).toBe("hello there");
      expect(runs.some((r) => r.label)).toBe(false);
    });
  });

  it("breaks non-adjacent words into runs separated by two spaces", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.toggleSelected({ segKey: a, wordIdx: 2 });
      expect(runsToText(s.copyRuns())).toBe("hello  world");
    });
  });

  it("labels whole segments, and only in the HTML flavor", () => {
    withStore((s) => {
      const [, b] = keys(s);
      s.setSelection({ segKey: b, wordIdx: null });
      const runs = s.copyRuns();
      expect(runsToText(runs)).toBe("again");
      expect(runsToHtml(runs)).toBe("<p><b>Bob:</b> again</p>");
    });
  });

  it("round-trips through the plain text unchanged", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.toggleSelected({ segKey: a, wordIdx: 2 });
      expect(tokenize(runsToText(s.copyRuns()))).toEqual(["hello", "world"]);
    });
  });

  it("yields nothing when nothing is selected", () => {
    withStore((s) => expect(s.copyRuns()).toEqual([]));
  });
});

describe("paste", () => {
  it("overlays one for one, keeping the original timestamps", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.toggleSelected({ segKey: a, wordIdx: 1 });
      s.pasteText("howdy folks", 0);
      expect(texts(s)[0]).toEqual(["howdy", "folks", "world"]);
      expect(times(s, 0)).toEqual([1.0, 1.5, 2.0]);
    });
  });

  it("deletes the slots the text doesn't reach", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.toggleSelected({ segKey: a, wordIdx: 1 });
      s.toggleSelected({ segKey: a, wordIdx: 2 });
      s.pasteText("hi", 0);
      expect(texts(s)[0]).toEqual(["hi"]);
      expect(times(s, 0)).toEqual([1.0]);
    });
  });

  it("subdivides the last slot over its own span when the text overflows", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.toggleSelected({ segKey: a, wordIdx: 1 });
      s.pasteText("a b c", 0);
      // "a" takes slot 0; "b" and "c" split slot 1's span of 1.5 → 2.0.
      expect(texts(s)[0]).toEqual(["a", "b", "c", "world"]);
      expect(times(s, 0)).toEqual([1.0, 1.5, 1.75, 2.0]);
    });
  });

  it("over a single word is exactly commitWordText", () => {
    const overlay = withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.pasteText("a b c", 0);
      return { texts: texts(s), times: times(s, 0) };
    });
    const edited = withStore((s) => {
      s.commitWordText(keys(s)[0], 0, "a b c");
      return { texts: texts(s), times: times(s, 0) };
    });
    expect(overlay).toEqual(edited);
  });

  it("lands words in their own segments across a boundary", () => {
    withStore((s) => {
      const [a, b] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 2 });
      s.toggleSelected({ segKey: b, wordIdx: 0 });
      s.pasteText("x y", 0);
      expect(texts(s)).toEqual([["hello", "there", "x"], ["y"]]);
      // Each keeps its segment's speaker — the words change hands, not the roles.
      expect(s.doc.segments.map((seg) => seg.speaker_id)).toEqual([0, 1]);
    });
  });

  it("fills a wholly selected segment and keeps its speaker", () => {
    withStore((s) => {
      const [, b] = keys(s);
      s.setSelection({ segKey: b, wordIdx: null });
      s.pasteText("one two", 0);
      expect(texts(s)[1]).toEqual(["one", "two"]);
      expect(times(s, 1)).toEqual([5.0, 5.25]);
      expect(s.doc.segments[1].speaker_id).toBe(1);
    });
  });

  it("counts a segment and a word inside it as one slot, not two", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: null });
      s.toggleSelected({ segKey: a, wordIdx: 0 });
      s.pasteText("p q r", 0);
      expect(texts(s)[0]).toEqual(["p", "q", "r"]);
    });
  });

  it("selects what it pasted", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.pasteText("a b", 0);
      expect(s.selectedItems()).toEqual([
        { segKey: a, wordIdx: 0 },
        { segKey: a, wordIdx: 1 },
      ]);
    });
  });

  it("treats whitespace-only text as a delete", () => {
    withStore((s) => {
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.pasteText("   \n ", 0);
      expect(texts(s)[0]).toEqual(["there", "world"]);
    });
  });

  it("is one undo step", () => {
    withStore((s) => {
      const before = texts(s);
      const [a] = keys(s);
      s.setSelection({ segKey: a, wordIdx: 0 });
      s.toggleSelected({ segKey: a, wordIdx: 1 });
      s.pasteText("a b c d", 0);
      s.undo();
      expect(texts(s)).toEqual(before);
      expect(s.canUndo()).toBe(false);
    });
  });

  describe("with nothing selected", () => {
    it("makes a segment at the playhead, spaced by the median gap", () => {
      withStore((s) => {
        s.pasteText("new words here", 7.0);
        const seg = s.doc.segments.find((x) => x.words[0]?.text === "new")!;
        expect(seg.words.map((w) => w.timestamp)).toEqual([7.0, 7.5, 8.0]);
      });
    });

    it("attributes it to whoever is talking there", () => {
      withStore((s) => {
        // 5.2s falls inside Bob's segment (5.0 + a 0.5s last word).
        s.pasteText("mine", 5.2);
        expect(s.doc.segments.find((x) => x.words[0]?.text === "mine")!.speaker_id).toBe(1);
      });
    });

    it("falls back to the preceding speaker past the last segment", () => {
      withStore((s) => {
        s.pasteText("mine", 9.0);
        expect(s.doc.segments.find((x) => x.words[0]?.text === "mine")!.speaker_id).toBe(1);
      });
    });

    it("divides the remaining time evenly when the clip ends first", () => {
      withStore((s) => {
        s.pasteText("a b c d", 9.0);
        const seg = s.doc.segments.find((x) => x.words[0]?.text === "a")!;
        // 1s left, four words → 0.25s each, none past the end.
        expect(seg.words.map((w) => w.timestamp)).toEqual([9.0, 9.25, 9.5, 9.75]);
      });
    });

    it("selects the new segment whole", () => {
      withStore((s) => {
        s.pasteText("hi", 7.0);
        expect(s.selection()?.wordIdx).toBe(null);
      });
    });

    it("does nothing with empty text", () => {
      withStore((s) => {
        s.pasteText("  ", 7.0);
        expect(s.doc.segments).toHaveLength(2);
        expect(s.canUndo()).toBe(false);
      });
    });
  });
});
