# alder

Audio annotation tool for correcting **transcription** (what was said, when) and
**diarization** (who said it). Built with TypeScript, SolidJS, Tailwind v4, and
Vite in a pnpm monorepo.

![screenshot](docs/screenshot.png)

## Packages

- **`packages/alder`** (`@nickcrews/alder`) — the annotator as an importable
  SolidJS library.
- **`packages/alder-standalone`** (`@nickcrews/alder-standalone`) — builds a
  fully self-contained `dist/index.html` (works from `file://`): open/save
  annotation JSON, import a WAV, drag & drop, and a bundled demo clip
  (`src/assets/en-16k.wav`, the 3.85 s "Ask not what your country…" sample,
  with estimated word timings to correct).

## Quick start

```sh
pnpm install
pnpm dev        # standalone app at http://localhost:5173
pnpm test       # vitest (serde, store ops, lanes, mount smoke test)
pnpm typecheck
pnpm build      # library ESM + single-file dist/index.html
```

## Data model

```ts
interface Speaker { id: number; label: string }
interface Word    { timestamp: number; text: string }  // seconds since clip start
interface Segment { speaker_id: number; words: Word[] }
interface AnnotationState {
  audio: Float32Array;
  sampleRate: number;
  speakers: Speaker[];
  segments: Segment[];
}
```

Timing is **start-only**: a word extends to the next word's timestamp; a
segment's last word gets a fixed `LAST_WORD_DURATION` (0.4 s). Segment extent
is derived from its words, never stored.

### Wire format

```jsonc
{
  "sample_rate": 16000,        // required when audio is raw PCM
  "audio": "<base64>",         // raw little-endian float32 mono PCM, or a WAV file (sniffed)
  "speakers": [{ "id": 0, "label": "Alice" }],
  "segments": [{ "speaker_id": 0, "words": [{ "timestamp": 0.5, "text": "hi" }] }]
}
```

Loading accepts raw f32 or WAV (PCM 8/16/24/32-bit int and float32,
multi-channel averaged to mono); saving always emits raw f32 + `sample_rate`.
From Python: `audio.astype("float32").tobytes()` → base64.

## Using the library

As a Solid component (uncontrolled; wrap `onChange`/`ref` to make it controlled):

```tsx
import { Annotator, parseAnnotation, serializeAnnotationString } from "@nickcrews/alder";

<Annotator
  initialState={parseAnnotation(json)}
  onChange={(state) => console.log("edited", state)}
  ref={(handle) => {
    // handle.getState() / handle.setState(state)
    // setState replaces speakers/segments; audio is fixed per instance (remount to change it)
  }}
/>;
```

Framework-free (this is the surface a future anywidget bridge builds on —
styles are injected automatically, ESM, no module-scope DOM access):

```ts
import { mountAnnotator } from "@nickcrews/alder";

const widget = mountAnnotator(el, { initialState, onChange });
// widget.getState(), widget.setState(s), widget.destroy()
```

Sketch of the eventual anywidget `render`:

```js
export default {
  render({ model, el }) {
    const widget = mountAnnotator(el, {
      initialState: parseAnnotation(model.get("annotation")),
      onChange: (s) => {
        model.set("annotation", serializeAnnotation(s));
        model.save_changes();
      },
    });
    return () => widget.destroy();
  },
};
```

## UI

I really tried to sweat the details to make the annotation process as delightful as possible.

- **Waveform**: click to seek, drag to pan, scroll/pinch to zoom (anchored at
  cursor), red playhead follows playback. Space = play/pause. Choose playback speed.
- **Tracks**: segments are packed greedily into lanes — overlapping speech
  stacks, alternating speakers share a lane. Colors are per-speaker.
- **Words**: drag to retime (clamped between neighbors); double-click to edit
  text — a space splits the word (timestamps interpolated), Backspace at the
  start joins into the previous word, empty text deletes. Arrow key nav.
  shift+click and ctrl+click multiselection works.
- **Segments**: drag the label strip to shift the whole segment in time.
   Right-click empty track space to create a segment.
   Select multiple and then click to merge them.
   Right click to split a segment at that timestamp.
- **Speakers**: add / rename (double-click) / delete (only when unused).
- **Copy/paste**: ⌘C writes the selection as text (plus HTML with speaker labels
  when whole segments are selected). ⌘V overlays the pasted words onto the
  selected ones slot by slot, each keeping the timestamp it lands on; surplus
  words subdivide the last slot, unused slots are deleted, so nothing outside
  the selection changes. With nothing selected it creates a segment at the
  playhead, evenly spaced by the median word gap. No cut.
- **Undo/redo**: ⌘Z / ⇧⌘Z, snapshot-based.
