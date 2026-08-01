import { Show, createSignal, onCleanup } from "solid-js";
import {
  Annotator,
  base64ToBytes,
  bufferSourceFromBytes,
  parseAnnotation,
  serializeAnnotationString,
  type AnnotationState,
  type AudioSource,
} from "@nickcrews/alder";
import { makeDemo } from "./demo";

const btn =
  "rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";

/** Audio and transcript are separate resources now: the annotator edits the
 * `state` and reads samples from the `source`. We pair them here for the life
 * of one loaded clip. */
interface Loaded {
  state: AnnotationState;
  source: AudioSource;
}

export function App() {
  const [loaded, setLoaded] = createSignal<Loaded | null>(null);
  const [name, setName] = createSignal("annotation");
  const [error, setError] = createSignal<string | null>(null);
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
        const source = await bufferSourceFromBytes(base64ToBytes(raw.audio), raw.sample_rate);
        load({ state, source }, file.name);
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const source = await bufferSourceFromBytes(bytes);
        load(
          {
            state: { speakers: [{ id: 0, label: "Speaker 1" }], segments: [] },
            source,
          },
          file.name,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadDemo() {
    try {
      load(await makeDemo(), "en-16k");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function pick(accept: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => input.files?.[0] && void openFile(input.files[0]);
    input.click();
  }

  function save() {
    if (!latest) return;
    const blob = new Blob([serializeAnnotationString(latest)], { type: "application/json" });
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
              <p class="text-sm text-zinc-600">or</p>
              <button class={btn} onClick={() => void loadDemo()}>
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
