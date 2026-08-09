import { createMemo, createSignal, type Accessor } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import type { AnnotationState, Speaker, Word } from "./types";
import { MIN_GAP, clamp, lastWordDuration, segEnd, segStart, wordEnd } from "./time";
import { type CopyRun, tokenize } from "./clipboard";

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

/** A selectable thing: a whole segment (`wordIdx: null`) or one word within it.
 * Positional — any splice of `seg.words` invalidates outstanding word items. */
export type Item = { segKey: number; wordIdx: number | null };
export type WordRef = { segKey: number; wordIdx: number };

export type Selection = Item | null;

const itemKey = (i: Item) => `${i.segKey}:${i.wordIdx ?? "seg"}`;
const sameItem = (a: Item, b: Item) => a.segKey === b.segKey && a.wordIdx === b.wordIdx;
const isWordItem = (i: Item): i is WordRef => i.wordIdx != null;

/** Ask the matching WordChip to enter edit mode. `seed` replaces the text
 * (typed-to-edit); null keeps it with the caret at the end (Enter-to-edit). */
export type EditRequest = { segKey: number; wordIdx: number; seed: string | null } | null;

const MAX_HISTORY = 200;

export type AnnotatorStore = ReturnType<typeof createAnnotatorStore>;

export interface StoreOptions {
  /** Where the audio ends, in seconds — no edit may push a word past it. An
   * {@link Accessor} because the end is learned late: audio arrives after the
   * transcript is already editable, so the value flips from unknown to known
   * mid-session and every clamp has to see the change.
   *
   * `null` means the end isn't known yet, and edits run unbounded to the right
   * rather than being clamped against a guess. It must never be derived from
   * the transcript itself — a bound that grows with the words it bounds never
   * binds, and the last word ratchets rightward one drag at a time. */
  audioEnd: Accessor<number | null>;
  /** Fired with the full annotation after every committed edit. */
  onChange?: (state: AnnotationState) => void;
}

/** A blank transcript: no segments, and one speaker to attribute the first one
 * to. What you get when you open audio with nothing transcribed yet, so callers
 * in that position pass `null` rather than hand-rolling this. */
export const emptyAnnotation = (): AnnotationState => ({
  speakers: [{ id: 0, label: "Speaker 1" }],
  segments: [],
});

/** `initial` may be `null`/omitted — audio with no transcript yet starts from
 * {@link emptyAnnotation}. */
export function createAnnotatorStore(
  initial: AnnotationState | null | undefined,
  opts: StoreOptions,
) {
  const { onChange } = opts;
  const start = initial ?? emptyAnnotation();
  /** {@link StoreOptions.audioEnd} as a clamp bound, with "not known yet"
   * spelled as `Infinity` so every call site can stay plain arithmetic. Only
   * {@link pasteAsSegment}, which squeezes words in to *reach* the end, has to
   * ask whether the end is finite. */
  const maxTime: Accessor<number> = () => opts.audioEnd() ?? Infinity;

  const toRec = (s: { speaker_id: number; words: Word[] }): SegRec => ({
    key: nextKey++,
    speaker_id: s.speaker_id,
    words: s.words.map((w) => ({ ...w })),
  });

  const [doc, setDoc] = createStore<Doc>({
    speakers: start.speakers.map((s) => ({ ...s })),
    segments: start.segments.map(toRec),
  });
  // The selection is one flat set of items that may freely mix whole segments
  // and individual words. `selection` is the focus (the item the caret is on,
  // and what keyboard edits act upon); `multiSel` holds the full set once it
  // grows past one; `anchor` is the pivot ⇧-ranges extend from.
  const [selection, setSelectionRaw] = createSignal<Selection>(null);
  const [multiSel, setMultiSel] = createSignal<Item[]>([]);
  const [anchor, setAnchor] = createSignal<Item | null>(null);
  const [editRequest, setEditRequest] = createSignal<EditRequest>(null);

  /** Select a single segment/word (or nothing), collapsing any multi-selection. */
  function setSelection(sel: Selection) {
    setMultiSel([]);
    setAnchor(null);
    setSelectionRaw(sel);
  }

  /** Everything selected: the multi-selection if active, else the lone focus. */
  function selectedItems(): Item[] {
    const m = multiSel();
    if (m.length) return m;
    const s = selection();
    return s ? [s] : [];
  }

  const selectedSet = createMemo(() => new Set(selectedItems().map(itemKey)));
  const isItemSelected = (i: Item) => selectedSet().has(itemKey(i));

  /** Words selected in their own right (not those inside a selected segment). */
  const selectedWords = (): WordRef[] => selectedItems().filter(isWordItem);
  /** Segments selected whole. */
  const selectedSegKeys = (): number[] =>
    selectedItems().filter((i) => i.wordIdx == null).map((i) => i.segKey);

  const isWordSelected = (segKey: number, wordIdx: number) =>
    isItemSelected({ segKey, wordIdx });
  const isSegSelected = (key: number) => isItemSelected({ segKey: key, wordIdx: null });
  /** The segment itself, or any word in it, is selected. */
  const segHasSelection = (key: number) => selectedItems().some((i) => i.segKey === key);

  /** Set the selection to `items`, focusing `focus` (default: the last item). */
  function setItems(items: Item[], focus?: Item) {
    setMultiSel(items.length > 1 ? items : []);
    setSelectionRaw(focus ?? items[items.length - 1] ?? null);
  }

  /** Toggle one segment or word in and out of the selection (⌥/⌘-click). */
  function toggleSelected(item: Item) {
    const cur = selectedItems();
    const has = cur.some((i) => sameItem(i, item));
    const next = has ? cur.filter((i) => !sameItem(i, item)) : [...cur, item];
    setAnchor(has ? null : item);
    if (!has) return setItems(next, item);
    // Removing the focus re-points it at whatever is left; removing anything
    // else leaves the focus where it was.
    const focus = selection();
    setItems(next, focus && sameItem(focus, item) ? next[next.length - 1] : (focus ?? undefined));
  }

  /** Select everything between the pivot and `item`, in time order (⇧-click,
   * ⇧-arrow). The pivot stays put so successive ⇧-clicks re-range from it.
   * A range only spans items of one kind; ⇧-clicking the other kind adds to
   * the selection instead, so a mixed selection is never clobbered. */
  function selectRangeTo(item: Item) {
    const pivot = anchor() ?? selection();
    if (!pivot || sameItem(pivot, item)) {
      setSelection(item);
      setAnchor(item);
      return;
    }
    if ((pivot.wordIdx == null) !== (item.wordIdx == null)) return toggleSelected(item);
    const flat: Item[] =
      item.wordIdx == null ? orderedSegs().map((s) => ({ segKey: s.key, wordIdx: null })) : orderedWords();
    const i = flat.findIndex((f) => sameItem(f, pivot));
    const j = flat.findIndex((f) => sameItem(f, item));
    if (i < 0 || j < 0) return;
    setAnchor(pivot);
    setItems(i < j ? flat.slice(i, j + 1) : flat.slice(j, i + 1), item);
  }
  const [histVersion, setHistVersion] = createSignal(0);

  const undoStack: Doc[] = [];
  const redoStack: Doc[] = [];
  const snap = (): Doc => structuredClone(unwrap(doc));

  const measuredDur = createMemo(() => lastWordDuration(doc.segments));
  const [frozenDur, setFrozenDur] = createSignal<number | null>(null);

  /** The file-wide median word duration used to size every segment's final
   * word. Held steady for the span of an op: without the latch, dragging one
   * word would shift the median and visibly resize the trailing word of every
   * other segment mid-gesture. */
  const lastWordDur = () => frozenDur() ?? measuredDur();

  /** True for the span of an op — i.e. while a drag is live. Lets the view hold
   * anything it derives from the document steady until the gesture ends. */
  const opActive = () => frozenDur() != null;

  /** Push an undo snapshot. Call once before an operation (or drag) begins. */
  function beginOp() {
    setFrozenDur(measuredDur());
    undoStack.push(snap());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    setHistVersion((v) => v + 1);
  }

  /** Commit the operation: discard the snapshot if nothing changed, else fire onChange. */
  function endOp() {
    setFrozenDur(null);
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
    setFrozenDur(null);
    undoStack.length = 0;
    redoStack.length = 0;
    setHistVersion((v) => v + 1);
  }

  const segIndex = (key: number) => doc.segments.findIndex((s) => s.key === key);
  const getSeg = (key: number): SegRec | undefined => doc.segments[segIndex(key)];

  const orderedSegs = () => [...doc.segments].sort((a, b) => segStart(a) - segStart(b));

  /** Every word in the document, in time order, as positional refs. */
  const orderedWords = (): WordRef[] =>
    orderedSegs().flatMap((s) => s.words.map((_, i) => ({ segKey: s.key, wordIdx: i })));

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
            : maxTime() - MIN_GAP;
        seg.words[i].timestamp = clamp(t, lo, Math.max(lo, hi));
      }),
    );
  }

  /**
   * Rigidly shift a set of words by `delta`, so a multi-selection drags as one
   * block. `origins` are the timestamps captured at drag start (parallel to
   * `refs`), so repeated calls are absolute and never drift. The shift is
   * clamped once for the whole set: whichever word runs into a *non-moving*
   * neighbour first stops all of them, which keeps the gaps within the set
   * intact instead of collapsing them one by one.
   */
  function moveWords(refs: WordRef[], origins: number[], delta: number) {
    if (!refs.length) return;
    const moving = new Set(refs.map(itemKey));
    let lo = -Infinity;
    let hi = Infinity;
    refs.forEach((r, n) => {
      const seg = getSeg(r.segKey);
      if (!seg || r.wordIdx < 0 || r.wordIdx >= seg.words.length) return;
      const i = r.wordIdx;
      const t0 = origins[n];
      if (!moving.has(itemKey({ segKey: r.segKey, wordIdx: i - 1 }))) {
        lo = Math.max(lo, (i > 0 ? seg.words[i - 1].timestamp + MIN_GAP : 0) - t0);
      }
      if (!moving.has(itemKey({ segKey: r.segKey, wordIdx: i + 1 }))) {
        const bound =
          i < seg.words.length - 1
            ? seg.words[i + 1].timestamp - MIN_GAP
            : maxTime() - MIN_GAP;
        hi = Math.min(hi, bound - t0);
      }
    });
    const d = clamp(delta, lo, Math.max(lo, hi));

    const bySeg = new Map<number, { i: number; t: number }[]>();
    refs.forEach((r, n) => {
      const arr = bySeg.get(r.segKey) ?? [];
      arr.push({ i: r.wordIdx, t: origins[n] + d });
      bySeg.set(r.segKey, arr);
    });
    for (const [key, items] of bySeg) {
      const idx = segIndex(key);
      if (idx < 0) continue;
      setDoc(
        "segments",
        idx,
        produce((seg) => {
          for (const { i, t } of items) {
            if (i >= 0 && i < seg.words.length) seg.words[i].timestamp = t;
          }
        }),
      );
    }
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
        const d = clamp(delta, -first, maxTime() - lastWordDur() - last);
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

  /** Merge the given segments into one, keeping the earliest segment's
   * key and speaker; words are interleaved in time order. */
  function mergeSegments(keys: number[]) {
    const set = new Set(keys);
    const segs = doc.segments.filter((s) => set.has(s.key));
    if (segs.length < 2) return;
    const targetKey = segs.reduce((a, b) => (segStart(b) < segStart(a) ? b : a)).key;
    beginOp();
    setDoc(
      produce((d) => {
        const words = d.segments
          .filter((s) => set.has(s.key))
          .flatMap((s) => s.words)
          .sort((x, y) => x.timestamp - y.timestamp);
        const target = d.segments.find((s) => s.key === targetKey)!;
        target.words = words;
        for (let i = d.segments.length - 1; i >= 0; i--) {
          const s = d.segments[i];
          if (set.has(s.key) && s.key !== targetKey) d.segments.splice(i, 1);
        }
      }),
    );
    setSelection({ segKey: targetKey, wordIdx: null });
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
          words: [{ timestamp: clamp(time, 0, maxTime() - lastWordDur()), text: "…" }],
        });
      }),
    );
    setSelection({ segKey: newKey, wordIdx: 0 });
    endOp();
  }

  const deleteSegment = (key: number) => deleteItems([{ segKey: key, wordIdx: null }]);
  const deleteSegments = (keys: number[]) =>
    deleteItems(keys.map((key) => ({ segKey: key, wordIdx: null })));
  const deleteWord = (key: number, i: number) => deleteItems([{ segKey: key, wordIdx: i }]);
  const deleteSelection = () => deleteItems(selectedItems());

  /** Delete any mix of whole segments and individual words as one undo step.
   * Segments left wordless go too. */
  function deleteItems(items: Item[]) {
    const segKeys = new Set(items.filter((i) => i.wordIdx == null).map((i) => i.segKey));
    // Words inside a segment that's going away wholesale need no separate work.
    const words = new Set(
      items.filter(isWordItem).filter((w) => !segKeys.has(w.segKey)).map(itemKey),
    );
    if (!words.size && !doc.segments.some((s) => segKeys.has(s.key))) return;
    // Deleting words lands on the nearest word before the first one removed, so
    // repeated ⌫ keeps eating backwards; it precedes every deletion, so its
    // index survives the splices. Deleting whole segments just clears.
    let after: Selection = null;
    if (!segKeys.size) {
      const flat = orderedWords();
      const first = flat.findIndex((w) => words.has(itemKey(w)));
      if (first > 0) after = flat[first - 1];
    }
    beginOp();
    setDoc(
      produce((d) => {
        for (const seg of d.segments) {
          if (segKeys.has(seg.key)) continue;
          for (let i = seg.words.length - 1; i >= 0; i--) {
            if (words.has(itemKey({ segKey: seg.key, wordIdx: i }))) seg.words.splice(i, 1);
          }
        }
        for (let i = d.segments.length - 1; i >= 0; i--) {
          if (segKeys.has(d.segments[i].key) || !d.segments[i].words.length) {
            d.segments.splice(i, 1);
          }
        }
      }),
    );
    setSelection(after);
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
        const span = wordEnd(seg.words, i, lastWordDur()) - w.timestamp;
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

  // ---- clipboard ----

  /** The selection as runs of adjacent words, in `orderedWords` order. A
   * wholly selected segment contributes all its words and carries its speaker
   * label; loose words contribute the stretches they form. */
  function copyRuns(): CopyRun[] {
    const sel = selectedItems();
    const wholeSegs = new Set(sel.filter((i) => i.wordIdx == null).map((i) => i.segKey));
    const loose = new Set(sel.filter(isWordItem).map(itemKey));
    const runs: CopyRun[] = [];
    for (const seg of orderedSegs()) {
      if (wholeSegs.has(seg.key)) {
        if (seg.words.length) {
          runs.push({
            label: doc.speakers.find((s) => s.id === seg.speaker_id)?.label,
            words: seg.words.map((w) => w.text),
          });
        }
        continue;
      }
      let run: CopyRun | null = null;
      seg.words.forEach((w, i) => {
        if (!loose.has(itemKey({ segKey: seg.key, wordIdx: i }))) {
          run = null;
          return;
        }
        if (!run) runs.push((run = { words: [] }));
        run.words.push(w.text);
      });
    }
    return runs;
  }

  /** Every word the selection covers — deduped and ordered by `orderedWords`,
   * so a segment selected whole and a word inside it yield one slot, not two. */
  function selectedSlots(): WordRef[] {
    const sel = selectedItems();
    const wholeSegs = new Set(sel.filter((i) => i.wordIdx == null).map((i) => i.segKey));
    const loose = new Set(sel.filter(isWordItem).map(itemKey));
    return orderedWords().filter((w) => wholeSegs.has(w.segKey) || loose.has(itemKey(w)));
  }

  /** Overlay `text` onto the selection, one pasted word per selected word, in
   * time order. Each word inherits the timestamp of the slot it lands on —
   * real ASR timings, which beat anything we could interpolate, because a
   * correction usually lines up with the words it replaces.
   *
   * The selection is the whole blast radius, so the ends are bounded rather
   * than spilling like a spreadsheet would: surplus words subdivide the final
   * slot over its own span, and slots the text doesn't reach are deleted.
   * (With one slot selected that subdivision is exactly `commitWordText` — the
   * same operation, reached a different way.)
   *
   * Slots spanning a segment boundary land in their respective segments and so
   * take on those speakers. With nothing selected the text becomes a new
   * segment at `atTime`. */
  function pasteText(text: string, atTime: number) {
    const tokens = tokenize(text);
    const slots = selectedSlots();
    if (!slots.length) return pasteAsSegment(tokens, atTime);
    if (!tokens.length) return deleteItems(selectedItems());

    const m = slots.length;
    const n = tokens.length;
    // Slot k takes token k; the last slot soaks up every leftover token, and
    // any slot the tokens never reach is dropped.
    const textsFor = (k: number): string[] | null =>
      k < m - 1 ? (k < n ? [tokens[k]] : null) : n >= m ? tokens.slice(m - 1) : null;

    const bySeg = new Map<number, { idx: number; texts: string[] | null }[]>();
    slots.forEach((slot, k) => {
      const list = bySeg.get(slot.segKey) ?? [];
      list.push({ idx: slot.wordIdx, texts: textsFor(k) });
      bySeg.set(slot.segKey, list);
    });

    beginOp();
    setDoc(
      produce((d) => {
        for (const seg of d.segments) {
          const ops = bySeg.get(seg.key);
          if (!ops) continue;
          // Back to front: splices then can't shift an index we've yet to use.
          for (let j = ops.length - 1; j >= 0; j--) {
            const { idx, texts } = ops[j];
            const w = seg.words[idx];
            if (!w) continue;
            if (!texts) {
              seg.words.splice(idx, 1);
            } else if (texts.length === 1) {
              w.text = texts[0];
            } else {
              const span = wordEnd(seg.words, idx, lastWordDur()) - w.timestamp;
              seg.words.splice(
                idx,
                1,
                ...texts.map((t, e) => ({
                  timestamp: w.timestamp + (span * e) / texts.length,
                  text: t,
                })),
              );
            }
          }
        }
        for (let i = d.segments.length - 1; i >= 0; i--) {
          if (!d.segments[i].words.length) d.segments.splice(i, 1);
        }
      }),
    );

    // Surviving slots keep their indices: dropped slots are always a suffix in
    // time order, hence the highest indices in their segment, and the only
    // slot that grows is the last one.
    const after: Item[] = [];
    slots.forEach((slot, k) => {
      if (k < m - 1) {
        if (k < n) after.push(slot);
      } else if (n >= m) {
        for (let e = 0; e <= n - m; e++) {
          after.push({ segKey: slot.segKey, wordIdx: slot.wordIdx + e });
        }
      }
    });
    setItems(after);
    endOp();
  }

  /** Pasting with nothing selected: a new segment at the playhead, attributed
   * to whoever the timeline says is talking there, its words spaced by the
   * file's median word gap — squeezed evenly if the clip ends first. */
  function pasteAsSegment(tokens: string[], atTime: number) {
    if (!tokens.length) return;
    beginOp();
    const n = tokens.length;
    const dur = maxTime();
    let start = clamp(atTime, 0, dur);
    let gap = Math.min(lastWordDur(), (dur - start) / n);
    if (gap < MIN_GAP) {
      gap = MIN_GAP;
      // Only worth backing the run up when there is an end to fit inside; with
      // no known end there is nothing to squeeze against.
      if (Number.isFinite(dur)) start = clamp(dur - n * gap, 0, dur);
    }
    const segs = orderedSegs();
    const covering = segs.find(
      (s) => segStart(s) <= start && segEnd(s, lastWordDur()) >= start,
    );
    const preceding = segs.filter((s) => segStart(s) <= start).pop();
    let spId = covering?.speaker_id ?? preceding?.speaker_id ?? doc.speakers[0]?.id;
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
          words: tokens.map((t, k) => ({ timestamp: start + gap * k, text: t })),
        });
      }),
    );
    setSelection({ segKey: newKey, wordIdx: null });
    endOp();
  }

  /** Move the selection to the previous/next word, crossing into the
   * neighboring segment (in time order) at segment boundaries. A selected
   * segment (wordIdx null) resolves to its first/last word. */
  function selectAdjacentWord(dir: 1 | -1) {
    const sel = selection();
    if (!sel) return;
    const ordered = orderedSegs();
    const si = ordered.findIndex((s) => s.key === sel.segKey);
    if (si < 0) return;
    const seg = ordered[si];
    const wi = (sel.wordIdx ?? (dir > 0 ? -1 : seg.words.length)) + dir;
    if (wi >= 0 && wi < seg.words.length) {
      setSelection({ segKey: seg.key, wordIdx: wi });
      return;
    }
    const next = ordered[si + dir];
    if (!next || !next.words.length) return;
    setSelection({ segKey: next.key, wordIdx: dir > 0 ? 0 : next.words.length - 1 });
  }

  /** Grow (or shrink) the selection by one item in time order (⇧-arrow) —
   * over words or over segments, matching what's focused. The first extension
   * drops the pivot at the focus, so reversing direction shrinks the range. */
  function extendSelection(dir: 1 | -1) {
    const focus = selection();
    if (!focus) return;
    const flat: Item[] =
      focus.wordIdx == null
        ? orderedSegs().map((s) => ({ segKey: s.key, wordIdx: null }))
        : orderedWords();
    const i = flat.findIndex((f) => sameItem(f, focus));
    const next = i < 0 ? undefined : flat[i + dir];
    if (!next) return;
    if (!anchor()) setAnchor(focus);
    selectRangeTo(next);
  }

  function requestWordEdit(segKey: number, wordIdx: number, seed: string | null) {
    setSelection({ segKey, wordIdx });
    setEditRequest({ segKey, wordIdx, seed });
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
    opActive,
    selection,
    setSelection,
    selectedItems,
    selectedSegKeys,
    selectedWords,
    isItemSelected,
    isSegSelected,
    isWordSelected,
    segHasSelection,
    toggleSelected,
    selectRangeTo,
    selectAdjacentWord,
    extendSelection,
    editRequest,
    setEditRequest,
    requestWordEdit,
    getSeg,
    lastWordDur,
    beginOp,
    endOp,
    moveWord,
    moveWords,
    moveSegment,
    setSegmentSpeaker,
    splitSegment,
    mergeSegments,
    createSegment,
    deleteSegment,
    deleteSegments,
    deleteWord,
    deleteItems,
    deleteSelection,
    commitWordText,
    joinWithPrev,
    copyRuns,
    pasteText,
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
