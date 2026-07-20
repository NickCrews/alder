export type { AnnotationJSON, AnnotationState, Segment, Speaker, Word } from "./types";
export { Annotator } from "./components/Annotator";
export type { AnnotatorHandle, AnnotatorProps } from "./components/Annotator";
export { mountAnnotator } from "./mount";
export type { MountedAnnotator } from "./mount";
export {
  base64ToBytes,
  bytesToBase64,
  decodeAudioBytes,
  isWav,
  parseAnnotation,
  parseWav,
  serializeAnnotation,
  serializeAnnotationString,
} from "./serde";
export { LAST_WORD_DURATION, segEnd, segStart, wordEnd } from "./time";
export { assignLanes } from "./lanes";
export { createAnnotatorStore } from "./store";
export type { AnnotatorStore, SegRec, Selection } from "./store";
export { speakerColor } from "./colors";
