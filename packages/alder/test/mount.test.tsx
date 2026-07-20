// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountAnnotator } from "../src/mount";
import type { AnnotationState } from "../src/types";

function makeState(): AnnotationState {
  return {
    audio: new Float32Array(8000),
    sampleRate: 8000,
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

describe("mountAnnotator", () => {
  it("mounts, exposes state, and unmounts", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const changes: AnnotationState[] = [];
    const handle = mountAnnotator(el, {
      initialState: makeState(),
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
});
