import { Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js";
import { Annotator } from "../../src/components/Annotator";
import { urlSource } from "../../src/audio";
import type { AnnotationState, Segment, Speaker } from "../../src/types";

interface Meta {
  speakers: Speaker[];
  segments: Segment[];
  psvName: string;
  audioName: string;
  dirName: string;
}

const btn =
  "rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";

function hms(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function App() {
  const [meta, setMeta] = createSignal<Meta | null>(null);
  const [state, setState] = createSignal<AnnotationState | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<string | null>(null);

  let latest: AnnotationState | null = null;

  // The audio doesn't wait on the transcript, or on anything else: the source
  // exists now and fills itself in, so the header fetch races the annotation
  // fetch below instead of queueing behind it.
  const source = urlSource("/audio.wav");

  onMount(() => {
    void (async () => {
      try {
        const res = await fetch("/api/annotation");
        if (!res.ok) throw new Error(`annotation request failed: ${res.status}`);
        const m = (await res.json()) as Meta;
        setMeta(m);
        const s: AnnotationState = {
          speakers: m.speakers,
          segments: m.segments,
        };
        latest = s;
        setState(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  });

  async function save(): Promise<void> {
    if (!latest || saving()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speakers: latest.speakers, segments: latest.segments }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `save failed: ${res.status}`);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (dirty()) e.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", onBeforeUnload);
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("beforeunload", onBeforeUnload);
    source.destroy();
  });

  return (
    <div class="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header class="flex items-center gap-3 border-b border-zinc-800 p-3">
        <h1 class="text-lg font-semibold tracking-tight">alder</h1>
        <Show when={meta()}>
          {(m) => (
            <span class="text-xs text-zinc-500">
              {m().dirName}/{m().psvName} · {m().segments.length} segments
              <Show when={source.duration()}>{(d) => <> · {hms(d())} of audio</>}</Show>
            </span>
          )}
        </Show>
        <span class="flex-1" />
        <Show when={savedAt() && !dirty()}>
          <span class="text-xs text-zinc-500">saved {savedAt()}</span>
        </Show>
        <Show when={dirty()}>
          <span class="text-xs text-amber-400">● unsaved</span>
        </Show>
        <button class={btn} disabled={!state() || saving() || !dirty()} onClick={() => void save()}>
          {saving() ? "Saving…" : "Save (⌘S)"}
        </button>
      </header>

      <Show when={error()}>
        <div class="border-b border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">{error()}</div>
      </Show>

      <main class="flex-1 p-4">
        <Switch>
          <Match when={state()} keyed>
            <Annotator
              initialState={state()!}
              audioSource={source}
              onChange={(next) => {
                latest = next;
                setDirty(true);
              }}
            />
          </Match>
          <Match when={!error()}>
            <div class="flex h-full min-h-96 items-center justify-center text-zinc-500">Loading…</div>
          </Match>
        </Switch>
      </main>
    </div>
  );
}
