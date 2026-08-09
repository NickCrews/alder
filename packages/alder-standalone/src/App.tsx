import { Show, createSignal, onCleanup } from "solid-js";
import {
  Annotator,
  base64ToBytes,
  bufferSourceFromBytes,
  parseAnnotation,
  emptyAnnotation,
  serializeAnnotationString,
  urlSource,
  type AnnotationState,
  type AudioSource,
} from "@nickcrews/alder";
// 3.85s JFK clip, 16 kHz mono float32. Vendored from open-minutes' pipeline
// test fixture (the sherpa/NeMo "en.wav" sample). Audio and transcript are
// separate sidecar resources: the transcript is plain JSON, the audio a real
// WAV inlined as a data URI so the single-file build stays self-contained.
import annotationJson from "./assets/en-16k.json?raw";
import wavUrl from "./assets/en-16k.wav?inline";

const btn =
  "rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";

/** Audio and transcript are separate resources now: the annotator edits the
 * `state` and reads samples from the `source`. We pair them here for the life
 * of one loaded clip. `state` is null when we opened audio with no transcript
 * to go with it — the annotator starts blank in that case. */
interface Loaded {
  state: AnnotationState | null;
  source: AudioSource;
}

export function App() {
  const [loaded, setLoaded] = createSignal<Loaded | null>(null);
  const [name, setName] = createSignal("annotation");
  const [error, setError] = createSignal<string | null>(null);
  const [url, setUrl] = createSignal("");
  // Latest committed annotation (updated by onChange); what Save writes.
  let latest: AnnotationState | null = null;

  function load(next: Loaded, fileName?: string) {
    setError(null);
    latest = next.state;
    if (fileName) setName(fileName.replace(/\.(json|wav)$/i, ""));
    // We own the source: release the one we're replacing.
    const prev = loaded();
    setLoaded(next);
    prev?.source.destroy();
  }

  onCleanup(() => loaded()?.source.destroy());

  async function openFile(file: File) {
    try {
      if (/\.json$/i.test(file.name)) {
        const raw = JSON.parse(await file.text());
        const state = parseAnnotation(raw);
        if (typeof raw.audio !== "string") {
          throw new Error("This JSON has no embedded audio — import a WAV to pair with it.");
        }
        const source = bufferSourceFromBytes(base64ToBytes(raw.audio), raw.sample_rate);
        load({ state, source }, file.name);
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const source = bufferSourceFromBytes(bytes);
        load({ state: null, source }, file.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** The bundled clip is a data-URI WAV, so it loads down the same path as any
   * other URL — nothing to fetch or decode here. */
  function loadDemo() {
    load({ state: parseAnnotation(annotationJson), source: urlSource(wavUrl) }, "en-16k");
  }

  /** Stream a WAV straight from a URL — no download, no decode up front. A URL
   * that turns out to be bad isn't an error here: the source never throws for
   * it, it reports the failure through `geometry`, and the annotator says so on
   * the waveform while the transcript stays editable. */
  function loadUrl() {
    const href = url().trim();
    if (!href) return;
    load({ state: null, source: urlSource(href) }, href.split("/").pop());
  }

  function pick(accept: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => input.files?.[0] && void openFile(input.files[0]);
    input.click();
  }

  function save() {
    // Nothing edited yet on a bare audio load: write the blank transcript the
    // annotator is showing rather than doing nothing.
    const blob = new Blob([serializeAnnotationString(latest ?? emptyAnnotation())], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div
      class="flex min-h-screen flex-col bg-zinc-950 text-zinc-100"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file) void openFile(file);
      }}
    >
      <header class="flex items-center gap-2 border-b border-zinc-800 p-3">
        <h1 class="mr-4 text-lg font-semibold tracking-tight">
          alder <span class="text-xs font-normal text-zinc-500">audio annotation</span>
        </h1>
        <button class={btn} onClick={() => pick(".json,application/json")}>
          Open JSON
        </button>
        <button class={btn} onClick={() => pick(".wav,audio/wav")}>
          Import WAV
        </button>
        <button class={btn} disabled={!loaded()} onClick={save}>
          Save
        </button>
        <span class="flex-1" />
        <Show when={loaded()}>
          <span class="text-xs text-zinc-500">{name()}.json</span>
        </Show>
      </header>

      <Show when={error()}>
        <div class="border-b border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error()}
        </div>
      </Show>

      <main class="flex-1 p-4">
        <Show
          when={loaded()}
          keyed
          fallback={
            <div class="flex h-full min-h-96 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-zinc-800 text-zinc-400">
              <p class="text-lg">Drop an annotation .json or a .wav anywhere</p>
              <p class="text-sm text-zinc-600">or load a WAV by URL</p>
              <form
                class="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  loadUrl();
                }}
              >
                <input
                  class="w-96 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
                  value={url()}
                  placeholder="https://example.com/audio.wav"
                  onInput={(e) => setUrl(e.currentTarget.value)}
                />
                <button class={btn} type="submit">
                  Load URL
                </button>
              </form>
              <p class="text-sm text-zinc-600">or</p>
              <button class={btn} onClick={loadDemo}>
                Load demo clip
              </button>
            </div>
          }
        >
          {(l) => (
            <Annotator
              initialState={l.state}
              audioSource={l.source}
              onChange={(next) => {
                latest = next;
              }}
            />
          )}
        </Show>
      </main>
    </div>
  );
}
