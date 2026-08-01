import {
  bufferSourceFromBytes,
  parseAnnotation,
  type AnnotationState,
  type AudioSource,
} from "@nickcrews/alder";
// 3.85s JFK clip, 16 kHz mono float32. Vendored from open-minutes' pipeline
// test fixture (the sherpa/NeMo "en.wav" sample). Audio and transcript are
// separate sidecar resources: the transcript is plain JSON, the audio a real
// WAV inlined as a data URI so the single-file build stays self-contained.
import annotationJson from "./assets/en-16k.json?raw";
import wavUrl from "./assets/en-16k.wav?inline";

export async function makeDemo(): Promise<{ state: AnnotationState; source: AudioSource }> {
  const state = parseAnnotation(annotationJson);
  const bytes = new Uint8Array(await (await fetch(wavUrl)).arrayBuffer());
  const source = await bufferSourceFromBytes(bytes);
  return { state, source };
}
