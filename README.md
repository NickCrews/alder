# alder

A delightful audio annotation tool for **transcription** (what was said, when) and
**diarization** (who said it). Built with TypeScript, SolidJS, Tailwind v4, and
Vite in a pnpm monorepo.

Try the single file html build on [github pages](https://nickcrews.github.io/alder/).

![screenshot](docs/screenshot.png)

## Annotation Data model

```ts
interface Speaker { id: number; label: string }
interface Word    { timestamp: number; text: string }  // seconds since clip start
interface Segment { speaker_id: number; words: Word[] }
interface AnnotationState { speakers: Speaker[]; segments: Segment[] }
```

Example:

```jsonc
{
  "speakers": [{ "id": 0, "label": "Alice" }, { "id": 1, "label" "Bob"}],
  "segments": [
    { "speaker_id": 0, "words": [{ "timestamp": 0.532, "text": "Hi." }] },
    { "speaker_id": 1, "words": [{ "timestamp": 1.23, "text": "What's" }, {"timestamp": 1.33, "text": "up?"}] }
  ]
}
```

Remarks:
- We only model the start time of a word, there is no notion of end/duration.
- The start/end of a Segment is implicit, derived from the contained Words.
- Segments can be overlapping, eg if two people are speaking at the same time.
- This data model is trivial to serialize to JSON.

## Audio Data Model

I designed this to work efficiently with static hosting services,
eg drop your hours long audio file in an S3 bucket or on GitHub pages,
point the frontend at that URL, and it just works with
efficient network and frontend-memory usage.

Audio can be provided inline as a raw array of little-endian float32 mono PCM, if you source the bytes
yourself.
Or you can pass a URL. Then the client makes `Range` requests
to the server to fetch the duration/sample rate, then lazily fetches
the actual audio data on demand.

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

## CLI

Annotate a directory holding a `.psv` (pipe-separated-values, see below) transcript and its `.wav` — built for
maintaining golden annotations in place:

```sh
npx @nickcrews/alder path/to/meeting_dir/
```

It picks the single `.psv` and `.wav` in the directory (or pass `--psv` /
`--audio`), serves the annotator on localhost, opens a browser, and writes
⌘S straight back to the `.psv`. `--port`, `--no-open`, and `--help` also work.

The server does nothing clever with the audio: it serves the `.wav` with
byte-range support and stops there. The browser reads the header for duration,
approximates the zoomed-out waveform by striding a few hundred small range reads
across the file, refines to exact samples as you zoom in, and streams playback
through an `<audio>` element. A 2h46m / 319 MB meeting costs a few MB in the tab
and seeks instantly — and because the server is just a static file host, the
same frontend works unchanged against an object store or GitHub Pages.

Saving is conservative, because the target is version-controlled golden data:

- Segments you didn't touch re-render byte-for-byte, so the diff shows only
  real edits.
- Writes go to a temp file and are renamed into place.
- If the `.psv` changed on disk since it was loaded, the save is refused
  rather than clobbering the other edit.
- Unknown `event_type` values are a parse error, never a silent drop.

### The `.psv` format

```
start_sec|event_type|event_data
0:00:07.81|meta|{"begin_speaker":"segmented:spk-0"}
0:00:07.81|text|Make
0:00:07.97|text|sure
```

A `meta` row carrying `begin_speaker` opens a segment; every `text` row after
it is a word in that segment. The `begin_speaker` string is the alder speaker
label, so renaming a speaker in the UI rewrites it everywhere it appears. Times
are `H:MM:SS.ss`, and round-trip at that centisecond resolution.

## Packages

- **`packages/alder`** (`@nickcrews/alder`) — the annotator as an importable
  SolidJS library, and the `alder` CLI (`cli/`).
- **`packages/alder-standalone`** (`@nickcrews/alder-standalone`) — builds a
  fully self-contained `dist/index.html` (works from `file://`): open/save
  annotation JSON, import a WAV, drag & drop, stream a WAV from a URL, and a
  bundled demo clip (`src/assets/en-16k.wav`, the 3.85 s "Ask not what your
  country…" sample, with estimated word timings to correct).

## Using the library

As a Solid component (uncontrolled; wrap `onChange`/`ref` to make it controlled):

```tsx
import { Annotator, parseAnnotation } from "@nickcrews/alder";

<Annotator
  initialState={parseAnnotation(json)}                   // transcript only
  audioSource="https://static.example.com/meeting.wav"   // audio, supplied separately
  onChange={(state) => console.log("edited", state)}
  ref={(handle) => {
    // handle.getState() / handle.setState(state)
    // setState replaces speakers/segments; audio is fixed per instance (remount to change it)
  }}
/>;
```

`initialState` is optional: omit it (or pass `null`) for audio you haven't
transcribed yet and the annotator starts from a blank transcript with one
speaker, ready to take segments — the same value `emptyAnnotation()` returns.

`audioSource` accepts a plain `"https://…"` URL string — the annotator builds a
`urlSource` for it, streams the WAV over `Range` requests, and tears that source
down on unmount. Pass an `AudioSource` object instead when you build it yourself
— `bufferSource(samples, rate)` for samples in memory,
`bufferSourceFromBytes(bytes)` for WAV/raw f32 bytes, or a `urlSource` you want
to configure or share; a source you pass stays caller-owned and the annotator
never destroys it.

Loading is a state a source passes through, not something to await. Every
constructor returns immediately, and `source.geometry()` — the clip's shape, as
opposed to its contents — reads `{ state: "pending" }`, `{ state: "known",
duration, sampleRate }`, or `{ state: "failed", error }`. One union, so the two
numbers can't be half-known and a failed source can't look loaded. Meanwhile
`peaks()` answers with whatever samples have arrived (a flat line at first) and
`createPlayer()` hands back a working transport bound to the URL, so a seek made
during download is simply where playback begins.

That's what lets audio and transcript stay decoupled: the transcript is editable
from the first frame, with the timeline sized to the words and edits unbounded
to the right until the audio says where the end is, while the waveform shows
"Loading audio…" (or a failure line) and fills itself in.

Framework-free (this is the surface a future anywidget bridge builds on —
styles are injected automatically, ESM, no module-scope DOM access):

```ts
import { mountAnnotator } from "@nickcrews/alder";

const widget = mountAnnotator(el, { initialState, audioSource, onChange });
// widget.getState(), widget.setState(s), widget.destroy()
```

Sketch of the eventual anywidget `render`:

```js
export default {
  async render({ model, el }) {
    const widget = mountAnnotator(el, {
      initialState: parseAnnotation(model.get("annotation")),
      audioSource: bufferSourceFromBytes(model.get("audio")), // sidecar bytes
      onChange: (s) => {
        model.set("annotation", serializeAnnotation(s));
        model.save_changes();
      },
    });
    return () => widget.destroy();
  },
};
```

## Quick start

```sh
pnpm install
pnpm dev        # standalone app at http://localhost:5173
pnpm test       # vitest (serde, store ops, lanes, psv/wav round-trips, mount smoke test)
pnpm typecheck
pnpm build      # library ESM + single-file dist/index.html + the CLI bundle

# the CLI, straight from the build output
node packages/alder/dist/cli/alder.js path/to/meeting_dir/
```