/** Read/write the pipe-separated annotation format used by open-minutes
 * golden files.
 *
 * ```
 * start_sec|event_type|event_data
 * 0:00:07.81|meta|{"begin_speaker":"segmented:spk-0"}
 * 0:00:07.81|text|Make
 * 0:00:07.90|text|sure
 * 0:00:07.95|text|to
 * 0:00:08.00|text|check
 * ```
 *
 * A `meta` row carrying `begin_speaker` opens a segment; every `text` row
 * after it is a word in that segment, until the next `begin_speaker`.
 */

import type { AnnotationState, Segment, Speaker, Word } from "../src/types";

export const PSV_HEADER = "start_sec|event_type|event_data";

export interface PsvSegment {
  /** The `begin_speaker` value verbatim, e.g. `segmented:spk-3`. */
  speaker: string;
  /** Everything else on the opening meta row, preserved across a round trip. */
  meta: Record<string, unknown>;
  words: Word[];
  /** 0-based line range in the source file, inclusive, covering the meta row
   * and its words. Used to splice edits back into an untouched file. */
  firstLine: number;
  lastLine: number;
}

export interface ParsedPsv {
  /** Every line of the source file, so unedited regions round-trip byte-exact. */
  lines: string[];
  segments: PsvSegment[];
  /** True if the file ended with a newline. */
  trailingNewline: boolean;
}

export class PsvError extends Error { }

/** `H:MM:SS.ss` (the format open-minutes writes) or a bare number of seconds. */
export function parseTimestamp(raw: string, line: number): number {
  const s = raw.trim();
  if (s === "") throw new PsvError(`line ${line + 1}: empty timestamp`);
  const parts = s.split(":");
  if (parts.length > 3) throw new PsvError(`line ${line + 1}: bad timestamp ${JSON.stringify(raw)}`);
  let total = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) {
      throw new PsvError(`line ${line + 1}: bad timestamp ${JSON.stringify(raw)}`);
    }
    total = total * 60 + n;
  }
  return total;
}

/** Inverse of {@link parseTimestamp}: `H:MM:SS.ss`, centisecond resolution. */
export function formatTimestamp(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const frac = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

/** Split into exactly three fields; `event_data` keeps any further pipes. */
function splitRow(line: string): [string, string, string] | null {
  const a = line.indexOf("|");
  if (a < 0) return null;
  const b = line.indexOf("|", a + 1);
  if (b < 0) return null;
  return [line.slice(0, a), line.slice(a + 1, b), line.slice(b + 1)];
}

export function parsePsv(text: string): ParsedPsv {
  const trailingNewline = text.endsWith("\n");
  const lines = (trailingNewline ? text.slice(0, -1) : text).split("\n");
  const segments: PsvSegment[] = [];
  let current: PsvSegment | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (i === 0 && line.trim() === PSV_HEADER) continue;
    const row = splitRow(line);
    if (!row) throw new PsvError(`line ${i + 1}: expected 3 pipe-separated fields`);
    const [rawTime, type, data] = row;

    if (type === "meta") {
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new PsvError(`line ${i + 1}: meta event_data is not valid JSON`);
      }
      if (typeof meta.begin_speaker !== "string") {
        throw new PsvError(`line ${i + 1}: meta event without a string begin_speaker`);
      }
      const { begin_speaker, ...rest } = meta;
      current = {
        speaker: begin_speaker,
        meta: rest,
        words: [],
        firstLine: i,
        lastLine: i,
      };
      segments.push(current);
    } else if (type === "text") {
      if (!current) {
        throw new PsvError(`line ${i + 1}: text event before any begin_speaker meta event`);
      }
      current.words.push({ timestamp: parseTimestamp(rawTime, i), text: data });
      current.lastLine = i;
    } else {
      throw new PsvError(`line ${i + 1}: unknown event_type ${JSON.stringify(type)}`);
    }
  }

  return { lines, segments, trailingNewline };
}

/** Render segments as PSV rows (no header). Segments are emitted in the order
 * given; the caller is responsible for sorting. */
export function renderPsvRows(segments: PsvSegment[]): string[] {
  const rows: string[] = [];
  for (const seg of segments) {
    if (seg.words.length === 0) continue;
    const start = Math.min(...seg.words.map((w) => w.timestamp));
    const meta = JSON.stringify({ begin_speaker: seg.speaker, ...seg.meta });
    rows.push(`${formatTimestamp(start)}|meta|${meta}`);
    for (const w of [...seg.words].sort((a, b) => a.timestamp - b.timestamp)) {
      if (w.text.includes("\n")) {
        throw new PsvError(`word ${JSON.stringify(w.text)} contains a newline, which PSV cannot represent`);
      }
      rows.push(`${formatTimestamp(w.timestamp)}|text|${w.text}`);
    }
  }
  return rows;
}

/** A whole file, header included. */
export function serializePsv(segments: PsvSegment[]): string {
  return [PSV_HEADER, ...renderPsvRows(sortSegments(segments))].join("\n") + "\n";
}

export function sortSegments(segments: PsvSegment[]): PsvSegment[] {
  return [...segments]
    .filter((s) => s.words.length > 0)
    .sort((a, b) => segStartOf(a) - segStartOf(b));
}

export function segStartOf(seg: PsvSegment): number {
  return seg.words.length ? Math.min(...seg.words.map((w) => w.timestamp)) : Infinity;
}

export function segEndOf(seg: PsvSegment): number {
  return seg.words.length ? Math.max(...seg.words.map((w) => w.timestamp)) : -Infinity;
}

/** PSV segments → an {@link AnnotationState}. Speaker ids are assigned in order
 * of first appearance; the PSV `begin_speaker` string becomes the alder speaker
 * label. */
export function psvToAnnotation(segments: PsvSegment[]): AnnotationState {
  const ids = new Map<string, number>();
  const speakers: Speaker[] = [];
  for (const seg of segments) {
    if (!ids.has(seg.speaker)) {
      ids.set(seg.speaker, speakers.length);
      speakers.push({ id: speakers.length, label: seg.speaker });
    }
  }
  const out: Segment[] = segments.map((seg) => ({
    speaker_id: ids.get(seg.speaker)!,
    words: seg.words.map((w) => ({ timestamp: w.timestamp, text: w.text })),
  }));
  return { speakers, segments: out };
}

/** Inverse of {@link psvToAnnotation}. `meta` extras are re-attached by
 * matching against the segments originally read, keyed by speaker and start
 * time; segments the user created get no extras. */
export function annotationToPsv(
  state: AnnotationState,
  original: PsvSegment[] = [],
): PsvSegment[] {
  const labels = new Map(state.speakers.map((s) => [s.id, s.label]));
  const extras = new Map<string, Record<string, unknown>>();
  for (const seg of original) {
    if (Object.keys(seg.meta).length) {
      extras.set(`${seg.speaker}@${formatTimestamp(segStartOf(seg))}`, seg.meta);
    }
  }
  const out = state.segments
    .filter((s) => s.words.length > 0)
    .map((s): PsvSegment => {
      const speaker = labels.get(s.speaker_id);
      if (speaker == null) throw new PsvError(`segment references unknown speaker id ${s.speaker_id}`);
      const words = s.words
        .map((w) => ({ timestamp: w.timestamp, text: w.text }))
        .sort((a, b) => a.timestamp - b.timestamp);
      const start = formatTimestamp(words[0].timestamp);
      return {
        speaker,
        meta: extras.get(`${speaker}@${start}`) ?? {},
        words,
        firstLine: -1,
        lastLine: -1,
      };
    });
  return sortSegments(out);
}

/** Rewrite a parsed file with new segments, preserving any lines that sit
 * outside the segment stream (a leading header, trailing blanks). Rows for
 * untouched segments re-render byte-identically, so a diff shows only real
 * edits. */
export function rewritePsv(parsed: ParsedPsv, next: PsvSegment[]): string {
  const rows = renderPsvRows(sortSegments(next));
  const firstSegLine = parsed.segments.length
    ? Math.min(...parsed.segments.map((s) => s.firstLine))
    : parsed.lines.length;
  const lastSegLine = parsed.segments.length
    ? Math.max(...parsed.segments.map((s) => s.lastLine))
    : parsed.lines.length - 1;
  const lines = [
    ...parsed.lines.slice(0, firstSegLine),
    ...rows,
    ...parsed.lines.slice(lastSegLine + 1),
  ];
  if (lines[0]?.trim() !== PSV_HEADER) lines.unshift(PSV_HEADER);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n") + "\n";
}
