import { createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import type { AnnotationState, Speaker, Word } from "./types";
import { LAST_WORD_DURATION, MIN_GAP, clamp, segStart, wordEnd } from "./time";

let nextKey = 1;

/** A Segment with a stable runtime identity (stripped on serialization). */
export interface SegRec {
  key: number;
  speaker_id: number;
  words: Word[];
}

export interface Doc {
  speakers: Speaker[];
  segments: SegRec[];
}

export type Selection = { segKey: number; wordIdx: number | null } | null;

const MAX_HISTORY = 200;

export type AnnotatorStore = ReturnType<typeof createAnnotatorStore>;

export function createAnnotatorStore(
  initial: AnnotationState,
  onChange?: (state: AnnotationState) => void,
) {
  const audio = initial.audio;
  const sampleRate = initial.sampleRate;
  const duration = audio.length / sampleRate;

  const toRec = (s: { speaker_id: number; words: Word[] }): SegRec => ({
    key: nextKey++,
    speaker_id: s.speaker_id,
    words: s.words.map((w) => ({ ...w })),
  });

  const [doc, setDoc] = createStore<Doc>({
    speakers: initial.speakers.map((s) => ({ ...s })),
    segments: initial.segments.map(toRec),
  });
  const [selection, setSelection] = createSignal<Selection>(null);
  const [histVersion, setHistVersion] = createSignal(0);

  const undoStack: Doc[] = [];
  const redoStack: Doc[] = [];
  const snap = (): Doc => structuredClone(unwrap(doc));

  /** Push an undo snapshot. Call once before an operation (or drag) begins. */
  function beginOp() {
    undoStack.push(snap());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    setHistVersion((v) => v + 1);
  }

  /** Commit the operation: discard the snapshot if nothing changed, else fire onChange. */
  function endOp() {
    const top = undoStack[undoStack.length - 1];
    if (top && JSON.stringify(top) === JSON.stringify(unwrap(doc))) {
      undoStack.pop();
      setHistVersion((v) => v + 1);
      return;
    }
    fireChange();
  }

  function fireChange() {
    onChange?.(getState());
  }

  function getState(): AnnotationState {
    const segments = doc.segments
      .map((s) => ({ speaker_id: s.speaker_id, words: s.words.map((w) => ({ ...w })) }))
      .sort((a, b) => segStart(a) - segStart(b));
    return {
      audio,
      sampleRate,
      speakers: doc.speakers.map((s) => ({ ...s })),
      segments,
    };
  }

  /** Replace speakers/segments (audio is fixed for the life of the store). */
  function setState(state: AnnotationState) {
    setDoc(
      reconcile(
        { speakers: state.speakers.map((s) => ({ ...s })), segments: state.segments.map(toRec) },
        { key: "key" },
      ),
    );
    setSelection(null);
    undoStack.length = 0;
    redoStack.length = 0;
    setHistVersion((v) => v + 1);
  }

  const segIndex = (key: number) => doc.segments.findIndex((s) => s.key === key);
  const getSeg = (key: number): SegRec | undefined => doc.segments[segIndex(key)];

  // ---- move ops (no snapshot; caller wraps in beginOp/endOp for drags) ----

  function moveWord(key: number, i: number, t: number) {
    const idx = segIndex(key);
    if (idx < 0) return;
    setDoc(
      "segments",
      idx,
      produce((seg) => {
        if (i < 0 || i >= seg.words.length) return;
        const lo = i > 0 ? seg.words[i - 1].timestamp + MIN_GAP : 0;
        const hi =
          i < seg.words.length - 1
            ? seg.words[i + 1].timestamp - MIN_GAP
            : duration - MIN_GAP;
        seg.words[i].timestamp = clamp(t, lo, Math.max(lo, hi));
      }),
    );
  }

  function moveSegment(key: number, delta: number) {
    const idx = segIndex(key);
    if (idx < 0) return;
    setDoc(
      "segments",
      idx,
      produce((seg) => {
        if (!seg.words.length) return;
        const first = seg.words[0].timestamp;
        const last = seg.words[seg.words.length - 1].timestamp;
        const d = clamp(delta, -first, duration - LAST_WORD_DURATION - last);
        for (const w of seg.words) w.timestamp += d;
      }),
    );
  }

  // ---- structural ops (self-contained: snapshot + commit) ----

  function setSegmentSpeaker(key: number, speakerId: number) {
    const idx = segIndex(key);
    if (idx < 0 || doc.segments[idx].speaker_id === speakerId) return;
    beginOp();
    setDoc("segments", idx, "speaker_id", speakerId);
    endOp();
  }

  /** Split before word i, producing two segments with the same speaker. */
  function splitSegment(key: number, i: number) {
    const idx = segIndex(key);
    if (idx < 0) return;
    const seg = doc.segments[idx];
    if (i <= 0 || i >= seg.words.length) return;
    beginOp();
    let newKey = 0;
    setDoc(
      produce((d) => {
        const s = d.segments[idx];
        const tail = s.words.splice(i);
        newKey = nextKey++;
        d.segments.splice(idx + 1, 0, { key: newKey, speaker_id: s.speaker_id, words: tail });
      }),
    );
    setSelection({ segKey: newKey, wordIdx: null });
    endOp();
  }

  /** Merge with the next segment (in time) that has the same speaker. */
  function mergeWithNext(key: number) {
    const seg = getSeg(key);
    if (!seg) return;
    const myStart = segStart(seg);
    let best: SegRec | null = null;
    for (const other of doc.segments) {
      if (other.key === key || other.speaker_id !== seg.speaker_id) continue;
      if (segStart(other) < myStart) continue;
      if (!best || segStart(other) < segStart(best)) best = other;
    }
    if (!best) return;
    const bestKey = best.key;
    beginOp();
    setDoc(
      produce((d) => {
        const a = d.segments.find((s) => s.key === key)!;
        const bIdx = d.segments.findIndex((s) => s.key === bestKey);
        const b = d.segments[bIdx];
        a.words = [...a.words, ...b.words].sort((x, y) => x.timestamp - y.timestamp);
        d.segments.splice(bIdx, 1);
      }),
    );
    setSelection({ segKey: key, wordIdx: null });
    endOp();
  }

  function createSegment(time: number, speakerId?: number) {
    beginOp();
    let spId = speakerId ?? doc.speakers[0]?.id;
    let newKey = 0;
    setDoc(
      produce((d) => {
        if (spId == null) {
          spId = nextSpeakerId(d.speakers);
          d.speakers.push({ id: spId, label: `Speaker ${spId + 1}` });
        }
        newKey = nextKey++;
        d.segments.push({
          key: newKey,
          speaker_id: spId,
          words: [{ timestamp: clamp(time, 0, duration - LAST_WORD_DURATION), text: "…" }],
        });
      }),
    );
    setSelection({ segKey: newKey, wordIdx: 0 });
    endOp();
  }

  function deleteSegment(key: number) {
    const idx = segIndex(key);
    if (idx < 0) return;
    beginOp();
    setDoc(produce((d) => void d.segments.splice(idx, 1)));
    setSelection(null);
    endOp();
  }

  function deleteWord(key: number, i: number) {
    const idx = segIndex(key);
    if (idx < 0) return;
    beginOp();
    setDoc(
      produce((d) => {
        const seg = d.segments[idx];
        seg.words.splice(i, 1);
        if (!seg.words.length) d.segments.splice(idx, 1);
      }),
    );
    setSelection(null);
    endOp();
  }

  /** Commit edited text for a word. Empty deletes it; internal whitespace
   * splits it into several words with timestamps interpolated over its span. */
  function commitWordText(key: number, i: number, text: string) {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return deleteWord(key, i);
    const idx = segIndex(key);
    if (idx < 0) return;
    beginOp();
    setDoc(
      "segments",
      idx,
      produce((seg) => {
        const w = seg.words[i];
        if (!w) return;
        const span = wordEnd(seg.words, i) - w.timestamp;
        const replacements = tokens.map((t, k) => ({
          timestamp: w.timestamp + (span * k) / tokens.length,
          text: t,
        }));
        seg.words.splice(i, 1, ...replacements);
      }),
    );
    endOp();
  }

  /** Join word i into word i-1 (concatenating text, keeping the earlier timestamp). */
  function joinWithPrev(key: number, i: number, currentText?: string) {
    const idx = segIndex(key);
    if (idx < 0 || i <= 0) return;
    beginOp();
    setDoc(
      "segments",
      idx,
      produce((seg) => {
        const w = seg.words[i];
        if (!w) return;
        seg.words[i - 1].text += currentText ?? w.text;
        seg.words.splice(i, 1);
      }),
    );
    setSelection({ segKey: key, wordIdx: i - 1 });
    endOp();
  }

  // ---- speakers ----

  const nextSpeakerId = (speakers: Speaker[]) =>
    speakers.reduce((m, s) => Math.max(m, s.id + 1), 0);

  function addSpeaker(label?: string): number {
    beginOp();
    let id = 0;
    setDoc(
      produce((d) => {
        id = nextSpeakerId(d.speakers);
        d.speakers.push({ id, label: label ?? `Speaker ${id + 1}` });
      }),
    );
    endOp();
    return id;
  }

  function renameSpeaker(id: number, label: string) {
    const idx = doc.speakers.findIndex((s) => s.id === id);
    if (idx < 0 || doc.speakers[idx].label === label) return;
    beginOp();
    setDoc("speakers", idx, "label", label);
    endOp();
  }

  function speakerInUse(id: number): boolean {
    return doc.segments.some((s) => s.speaker_id === id);
  }

  function deleteSpeaker(id: number) {
    if (speakerInUse(id)) return;
    const idx = doc.speakers.findIndex((s) => s.id === id);
    if (idx < 0) return;
    beginOp();
    setDoc(produce((d) => void d.speakers.splice(idx, 1)));
    endOp();
  }

  // ---- history ----

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(snap());
    setDoc(reconcile(prev, { key: "key" }));
    setSelection(null);
    setHistVersion((v) => v + 1);
    fireChange();
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(snap());
    setDoc(reconcile(next, { key: "key" }));
    setSelection(null);
    setHistVersion((v) => v + 1);
    fireChange();
  }

  const canUndo = () => {
    histVersion();
    return undoStack.length > 0;
  };
  const canRedo = () => {
    histVersion();
    return redoStack.length > 0;
  };

  return {
    doc,
    audio,
    sampleRate,
    duration,
    selection,
    setSelection,
    getSeg,
    beginOp,
    endOp,
    moveWord,
    moveSegment,
    setSegmentSpeaker,
    splitSegment,
    mergeWithNext,
    createSegment,
    deleteSegment,
    deleteWord,
    commitWordText,
    joinWithPrev,
    addSpeaker,
    renameSpeaker,
    speakerInUse,
    deleteSpeaker,
    undo,
    redo,
    canUndo,
    canRedo,
    getState,
    setState,
  };
}
