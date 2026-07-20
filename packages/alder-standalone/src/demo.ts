import { parseAnnotation, type AnnotationState } from "@nickcrews/alder";
// 3.85s JFK clip, 16 kHz mono PCM with real word timestamps. Vendored from
// open-minutes' pipeline test fixture (the sherpa/NeMo "en.wav" sample).
import annotationJson from "./assets/en-16k.json?raw";

export function makeDemo(): AnnotationState {
  return parseAnnotation(annotationJson);
}
