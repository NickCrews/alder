import { Show, createSignal } from "solid-js";
import {
  Annotator,
  decodeAudioBytes,
  parseAnnotation,
  serializeAnnotationString,
  type AnnotationState,
} from "@nickcrews/alder";
import { makeDemo } from "./demo";

const btn =
  "rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";

export function App() {
  const [state, setState] = createSignal<AnnotationState | null>(null);
  const [name, setName] = createSignal("annotation");
  const [error, setError] = createSignal<string | null>(null);
  // Latest committed annotation (updated by onChange); what Save writes.
  let latest: AnnotationState | null = null;

  function load(s: AnnotationState, fileName?: string) {
    setError(null);
    latest = s;
    if (fileName) setName(fileName.replace(/\.(json|wav)$/i, ""));
    setState(s);
  }

  async function openFile(file: File) {
    try {
      if (/\.json$/i.test(file.name)) {
        load(parseAnnotation(await file.text()), file.name);
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { audio, sampleRate } = decodeAudioBytes(bytes);
        load(
          {
            audio,
            sampleRate,
            speakers: [{ id: 0, label: "Speaker 1" }],
            segments: [],
          },
          file.name,
        );
      }
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
        <button class={btn} disabled={!state()} onClick={save}>
          Save
        </button>
        <span class="flex-1" />
        <Show when={state()}>
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
          when={state()}
          keyed
          fallback={
            <div class="flex h-full min-h-96 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-zinc-800 text-zinc-400">
              <p class="text-lg">Drop an annotation .json or a .wav anywhere</p>
              <p class="text-sm text-zinc-600">or</p>
              <button class={btn} onClick={() => load(makeDemo(), "en-16k")}>
                Load demo clip
              </button>
            </div>
          }
        >
          {(s) => (
            <Annotator
              initialState={s}
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
