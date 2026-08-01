import { describe, expect, it } from "vitest";
import {
  PSV_HEADER,
  annotationToPsv,
  formatTimestamp,
  parsePsv,
  parseTimestamp,
  psvToAnnotation,
  rewritePsv,
  serializePsv,
} from "../cli/psv";

const FILE = [
  PSV_HEADER,
  `0:00:07.81|meta|{"begin_speaker":"segmented:spk-0"}`,
  "0:00:07.81|text|Make",
  "0:00:07.97|text|sure",
  `0:00:23.49|meta|{"begin_speaker":"segmented:spk-1"}`,
  "0:00:23.49|text|Okay,",
  "1:02:03.04|text|later",
  "",
].join("\n");

describe("timestamps", () => {
  it("parses the H:MM:SS.ss form open-minutes writes", () => {
    expect(parseTimestamp("0:00:07.81", 0)).toBeCloseTo(7.81, 6);
    expect(parseTimestamp("2:45:57.13", 0)).toBeCloseTo(9957.13, 6);
  });

  it("accepts shorter forms and bare seconds", () => {
    expect(parseTimestamp("07.81", 0)).toBeCloseTo(7.81, 6);
    expect(parseTimestamp("1:30", 0)).toBeCloseTo(90, 6);
  });

  it("round-trips through formatting", () => {
    for (const t of ["0:00:00.00", "0:00:07.81", "1:02:03.04", "2:45:57.13"]) {
      expect(formatTimestamp(parseTimestamp(t, 0))).toBe(t);
    }
  });

  it("rejects nonsense", () => {
    expect(() => parseTimestamp("", 0)).toThrow();
    expect(() => parseTimestamp("abc", 0)).toThrow();
    expect(() => parseTimestamp("1:2:3:4", 0)).toThrow();
  });
});

describe("parsePsv", () => {
  it("groups words under the preceding begin_speaker", () => {
    const { segments } = parsePsv(FILE);
    expect(segments).toHaveLength(2);
    expect(segments[0].speaker).toBe("segmented:spk-0");
    expect(segments[0].words.map((w) => w.text)).toEqual(["Make", "sure"]);
    expect(segments[1].words[1]).toEqual({ timestamp: 3723.04, text: "later" });
  });

  it("records the line span of each segment", () => {
    const { segments } = parsePsv(FILE);
    expect([segments[0].firstLine, segments[0].lastLine]).toEqual([1, 3]);
    expect([segments[1].firstLine, segments[1].lastLine]).toEqual([4, 6]);
  });

  it("keeps pipes inside word text", () => {
    const { segments } = parsePsv(
      [PSV_HEADER, `0:00:01.00|meta|{"begin_speaker":"s"}`, "0:00:01.00|text|a|b"].join("\n"),
    );
    expect(segments[0].words[0].text).toBe("a|b");
    expect(serializePsv(segments)).toContain("0:00:01.00|text|a|b");
  });

  it("refuses to silently drop data it doesn't understand", () => {
    expect(() =>
      parsePsv([PSV_HEADER, `0:00:01.00|beep|{"x":1}`].join("\n")),
    ).toThrow(/unknown event_type/);
    expect(() => parsePsv([PSV_HEADER, "0:00:01.00|text|orphan"].join("\n"))).toThrow(
      /before any begin_speaker/,
    );
    expect(() => parsePsv([PSV_HEADER, "0:00:01.00|meta|not json"].join("\n"))).toThrow(/valid JSON/);
    expect(() => parsePsv([PSV_HEADER, "just one field"].join("\n"))).toThrow(/3 pipe-separated/);
  });

  it("round-trips a file byte-for-byte", () => {
    expect(serializePsv(parsePsv(FILE).segments)).toBe(FILE);
  });
});

describe("annotation conversion", () => {
  it("assigns speaker ids in order of first appearance", () => {
    const { speakers, segments } = psvToAnnotation(parsePsv(FILE).segments);
    expect(speakers).toEqual([
      { id: 0, label: "segmented:spk-0" },
      { id: 1, label: "segmented:spk-1" },
    ]);
    expect(segments.map((s) => s.speaker_id)).toEqual([0, 1]);
  });

  it("survives a full there-and-back trip", () => {
    const parsed = parsePsv(FILE);
    const back = annotationToPsv(psvToAnnotation(parsed.segments), parsed.segments);
    expect(serializePsv(back)).toBe(FILE);
  });

  it("preserves meta keys it doesn't own", () => {
    const src = [
      PSV_HEADER,
      `0:00:01.00|meta|{"begin_speaker":"s","confidence":0.5}`,
      "0:00:01.00|text|hi",
      "",
    ].join("\n");
    const parsed = parsePsv(src);
    const back = annotationToPsv(psvToAnnotation(parsed.segments), parsed.segments);
    expect(serializePsv(back)).toBe(src);
  });

  it("drops segments left with no words", () => {
    const out = annotationToPsv({
      speakers: [{ id: 0, label: "s" }],
      segments: [{ speaker_id: 0, words: [] }],
    });
    expect(out).toEqual([]);
  });

  it("rejects a segment pointing at a speaker that no longer exists", () => {
    expect(() =>
      annotationToPsv({
        speakers: [{ id: 0, label: "s" }],
        segments: [{ speaker_id: 7, words: [{ timestamp: 1, text: "x" }] }],
      }),
    ).toThrow(/unknown speaker id/);
  });

  it("sorts words and segments by time regardless of input order", () => {
    const out = annotationToPsv({
      speakers: [{ id: 0, label: "a" }],
      segments: [
        { speaker_id: 0, words: [{ timestamp: 9, text: "late" }] },
        { speaker_id: 0, words: [{ timestamp: 3, text: "b" }, { timestamp: 1, text: "a" }] },
      ],
    });
    expect(out[0].words.map((w) => w.text)).toEqual(["a", "b"]);
    expect(out[1].words[0].text).toBe("late");
  });
});

describe("rewritePsv", () => {
  it("changes only the rows that actually changed", () => {
    const parsed = parsePsv(FILE);
    const state = psvToAnnotation(parsed.segments);
    state.segments[0].words[0].text = "MAKE";
    const out = rewritePsv(parsed, annotationToPsv(state, parsed.segments));
    const before = FILE.split("\n");
    const after = out.split("\n");
    const changed = after.filter((line, i) => line !== before[i]);
    expect(changed).toEqual(["0:00:07.81|text|MAKE"]);
  });

  it("keeps a new word in time order rather than appending it", () => {
    const parsed = parsePsv(FILE);
    const state = psvToAnnotation(parsed.segments);
    state.segments[0].words.push({ timestamp: 7.9, text: "very" });
    const out = rewritePsv(parsed, annotationToPsv(state, parsed.segments));
    expect(out.split("\n").slice(1, 5)).toEqual([
      `0:00:07.81|meta|{"begin_speaker":"segmented:spk-0"}`,
      "0:00:07.81|text|Make",
      "0:00:07.90|text|very",
      "0:00:07.97|text|sure",
    ]);
  });

  it("always emits a header, even for a file that lost one", () => {
    const parsed = parsePsv(`0:00:01.00|meta|{"begin_speaker":"s"}\n0:00:01.00|text|hi\n`);
    expect(rewritePsv(parsed, parsed.segments).split("\n")[0]).toBe(PSV_HEADER);
  });
});
