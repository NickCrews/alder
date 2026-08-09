// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountAnnotator } from "../src/mount";
import { bufferSource } from "../src/audio";
import type { AnnotationState } from "../src/types";

function makeState(): AnnotationState {
  return {
    speakers: [{ id: 0, label: "Alice" }],
    segments: [
      {
        speaker_id: 0,
        words: [
          { timestamp: 0.1, text: "hi" },
          { timestamp: 0.4, text: "there" },
        ],
      },
    ],
  };
}

/** Minimal 16-bit mono WAV of `n` silent frames at 8 kHz. */
function silentWav(n: number): Uint8Array {
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true);
  dv.setUint32(28, 16000, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, n * 2, true);
  return new Uint8Array(buf);
}

/** Serve `frames` of silence at 8 kHz to every request, 200 with the whole
 * body — the way a host that ignores `Range` answers, and the path any clip
 * this small takes regardless. */
function stubWholeFileFetch(frames: number) {
  const wav = silentWav(frames);
  vi.stubGlobal("fetch", () =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(wav.slice().buffer),
    }),
  );
}

/** Yield to the event loop. A macrotask, deliberately: it lands behind every
 * promise the source has already queued, so the audio has finished arriving by
 * the time this resolves. */
const flushAsync = () => new Promise((r) => setTimeout(r, 0));

/** jsdom has no PointerEvent, and `startDrag` only reads MouseEvent fields. */
const ptr = (type: string, clientX: number) =>
  new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 10 });

/** The word chip for `text`, found by the title the chip renders. */
const chip = (el: HTMLElement, text: string) =>
  el.querySelector<HTMLElement>(`[title^="${text} @"]`)!;

/** Press on `node`, drag the pointer through each x in `xs`, then release. */
function drag(node: HTMLElement, ...xs: number[]) {
  node.dispatchEvent(ptr("pointerdown", 0));
  for (const x of xs) window.dispatchEvent(ptr("pointermove", x));
  window.dispatchEvent(ptr("pointerup", xs[xs.length - 1]));
}

describe("mountAnnotator", () => {
  it("mounts, exposes state, and unmounts", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const changes: AnnotationState[] = [];
    const handle = mountAnnotator(el, {
      initialState: makeState(),
      audioSource: bufferSource(new Float32Array(8000), 8000),
      onChange: (s) => changes.push(s),
    });

    expect(el.querySelector(".alder-root")).toBeTruthy();
    expect(el.textContent).toContain("hi");
    expect(el.textContent).toContain("Alice");

    const state = handle.getState();
    expect(state.segments[0].words.length).toBe(2);

    handle.setState({ ...state, segments: [] });
    expect(handle.getState().segments.length).toBe(0);

    handle.destroy();
    expect(el.textContent).toBe("");
    el.remove();
  });

  describe("URL string audioSource", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("shows the transcript immediately, then streams the audio in", async () => {
      stubWholeFileFetch(8000);

      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = mountAnnotator(el, {
        initialState: makeState(),
        audioSource: "https://static.example.com/clip.wav",
      });

      // Audio is still in flight, but the transcript is already here and the
      // waveform shows its loading state — the two are decoupled.
      expect(el.textContent).toContain("Alice");
      expect(el.textContent).toContain("hi");
      expect(el.textContent).toContain("Loading audio…");
      expect(handle.getState().segments[0].words.length).toBe(2);

      await flushAsync();

      // Source resolved: the loading state clears, transcript stays put.
      expect(el.textContent).not.toContain("Loading audio…");
      expect(el.textContent).toContain("Alice");

      handle.destroy();
      el.remove();
    });

    it("keeps the transcript editable when the URL can't be loaded", async () => {
      vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404 }));

      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = mountAnnotator(el, {
        initialState: makeState(),
        audioSource: "https://static.example.com/missing.wav",
      });

      await flushAsync();

      // Audio failed, but the transcript is untouched and still there.
      expect(el.textContent).toContain("Audio failed to load");
      expect(el.textContent).toContain("Alice");
      const state = handle.getState();
      handle.setState({ ...state, segments: [] });
      expect(handle.getState().segments.length).toBe(0);

      handle.destroy();
      el.remove();
    });

    it("hands a seek made during loading to the player that arrives", async () => {
      stubWholeFileFetch(80_000); // 10s at 8 kHz

      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = mountAnnotator(el, {
        initialState: makeState(),
        audioSource: "https://static.example.com/clip.wav",
      });

      // Click the waveform while it still says "Loading audio…". The timeline
      // spans the transcript (0–0.7s) over 800px, so 600px in is ~0.53s.
      expect(el.textContent).toContain("Loading audio…");
      const clock = () => el.querySelector<HTMLElement>(".font-mono.text-zinc-400")!.textContent;
      el.querySelector<HTMLElement>("[class*='cursor-crosshair']")!.dispatchEvent(
        ptr("pointerdown", 600),
      );
      window.dispatchEvent(ptr("pointerup", 600));
      expect(clock()).toContain("0:00.5"); // the playhead went where we clicked

      await flushAsync();

      // The real player inherited that position rather than starting at zero.
      expect(el.textContent).not.toContain("Loading audio…");
      expect(clock()).toContain("0:00.5");
      expect(clock()).toContain("0:10.0"); // and the clip's true length is known

      handle.destroy();
      el.remove();
    });

    it("keeps a dragged word under the cursor as the timeline grows", () => {
      vi.stubGlobal("fetch", () => new Promise(() => {})); // audio never arrives

      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = mountAnnotator(el, {
        initialState: makeState(),
        audioSource: "https://static.example.com/slow.wav",
      });

      // With no audio the auto-fit spans the transcript, so dragging the last
      // word rightward extends the very thing the view is fitted to. If the fit
      // followed it mid-gesture the px-per-second scale would shrink under the
      // cursor and the word would outrun the pointer; the drag must stay linear.
      const moved = () => handle.getState().segments[0].words[1].timestamp - 0.4;
      const node = chip(el, "there");
      node.dispatchEvent(ptr("pointerdown", 0));
      window.dispatchEvent(ptr("pointermove", 1000));
      const half = moved();
      expect(half).toBeGreaterThan(0);
      window.dispatchEvent(ptr("pointermove", 2000));
      expect(moved()).toBeCloseTo(half * 2, 6); // twice the pixels, twice the time
      window.dispatchEvent(ptr("pointerup", 2000));

      handle.destroy();
      el.remove();
    });

    it("never lets a word be dragged past the end of the audio", async () => {
      stubWholeFileFetch(80_000); // 10s at 8 kHz

      const el = document.createElement("div");
      document.body.appendChild(el);
      const handle = mountAnnotator(el, {
        initialState: makeState(),
        audioSource: "https://static.example.com/clip.wav",
      });
      await flushAsync();

      const last = () => handle.getState().segments[0].words[1].timestamp;
      // Three shoves well past the end. The wall is the audio's length, and it
      // has to stay there: derive it from the transcript instead and each drag
      // pushes the wall out, letting the word ratchet off the clip entirely.
      for (let i = 0; i < 3; i++) {
        drag(chip(el, "there"), 8000);
        expect(last()).toBeLessThanOrEqual(10);
        expect(last()).toBeGreaterThan(9);
      }

      handle.destroy();
      el.remove();
    });
  });
});
